# Long-lived, near-zero-cost resources shared by every deployment session:
#   * S3 bucket for the dev stack's Terraform state (versioned, encrypted)
#   * S3 bucket for ALB access logs and load-test reports
#   * ECR repository for the application image
#   * AWS Budget alert
# The hourly-billed infrastructure lives in ../envs/dev and is destroyed
# after each session; these resources stay.

data "aws_caller_identity" "current" {}

# ELB's regional service account must be allowed to write ALB access logs.
data "aws_elb_service_account" "this" {}

locals {
  account_id      = data.aws_caller_identity.current.account_id
  state_bucket    = "${var.project}-tfstate-${local.account_id}"
  artifact_bucket = "${var.project}-artifacts-${local.account_id}"
}

# --------------------------------------------------------------------------
# S3: Terraform state
# --------------------------------------------------------------------------
# Accepted: SSE-S3 instead of a customer-managed KMS key ($1/month per key) and
# no server access logging (extra bucket + cost) for a coursework account.
#trivy:ignore:AVD-AWS-0132
#trivy:ignore:AVD-AWS-0089
resource "aws_s3_bucket" "state" {
  bucket        = local.state_bucket
  force_destroy = var.allow_destroy_with_data
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled" # recover from a corrupted/overwritten state file
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# --------------------------------------------------------------------------
# S3: artifacts (ALB access logs under alb-logs/, load-test reports under loadtest/)
# --------------------------------------------------------------------------
# Accepted: ALB log delivery only supports SSE-S3, so no KMS CMK; no access logging.
#trivy:ignore:AVD-AWS-0132
#trivy:ignore:AVD-AWS-0089
resource "aws_s3_bucket" "artifacts" {
  bucket        = local.artifact_bucket
  force_destroy = var.allow_destroy_with_data
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-alb-logs"
    status = "Enabled"
    filter {
      prefix = "alb-logs/"
    }
    expiration {
      days = 30
    }
  }

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# --------------------------------------------------------------------------
# Common hardening for both buckets
# --------------------------------------------------------------------------
locals {
  buckets = {
    state     = aws_s3_bucket.state
    artifacts = aws_s3_bucket.artifacts
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = local.buckets

  bucket = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced" # ACLs disabled
  }
}

# SSE-S3 (AES256): free, and the only encryption ALB log delivery supports.
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.buckets

  bucket = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.deny_insecure_transport["state"]]
  })
  depends_on = [aws_s3_bucket_public_access_block.state, aws_s3_bucket_public_access_block.artifacts]
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      local.deny_insecure_transport["artifacts"],
      {
        Sid       = "AllowAlbAccessLogDelivery"
        Effect    = "Allow"
        Principal = { AWS = data.aws_elb_service_account.this.arn }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.artifacts.arn}/alb-logs/AWSLogs/${local.account_id}/*"
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.state, aws_s3_bucket_public_access_block.artifacts]
}

locals {
  # Reject any request that is not made over HTTPS.
  deny_insecure_transport = {
    for key, bucket in local.buckets : key => {
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [bucket.arn, "${bucket.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }
  }
}

# --------------------------------------------------------------------------
# ECR repository
# --------------------------------------------------------------------------
# Accepted: AES256 (AWS-managed) encryption; a KMS CMK adds cost without benefit here.
#trivy:ignore:AVD-AWS-0033
resource "aws_ecr_repository" "app" {
  name = var.project
  # Tags are git commit SHAs and can never be overwritten, so a running
  # deployment always maps to exactly one build.
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.allow_destroy_with_data

  image_scanning_configuration {
    scan_on_push = true # free basic vulnerability scan
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only the last ${var.ecr_keep_last_images} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.ecr_keep_last_images
      }
      action = { type = "expire" }
    }]
  })
}

# --------------------------------------------------------------------------
# Budget alert (first two budgets per account are free)
# --------------------------------------------------------------------------
resource "aws_budgets_budget" "monthly" {
  count = length(var.budget_alert_emails) > 0 ? 1 : 0

  name         = "${var.project}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_alert_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_alert_emails
  }
}
