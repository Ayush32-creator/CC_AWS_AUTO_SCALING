output "state_bucket" {
  description = "S3 bucket for the dev stack's remote state (put this in envs/dev/backend.hcl)."
  value       = aws_s3_bucket.state.bucket
}

output "artifacts_bucket" {
  description = "S3 bucket for ALB access logs and load-test reports (artifacts_bucket_name in dev tfvars)."
  value       = aws_s3_bucket.artifacts.bucket
}

output "ecr_repository_name" {
  description = "ECR repository name (ecr_repository_name in dev tfvars)."
  value       = aws_ecr_repository.app.name
}

output "ecr_repository_url" {
  description = "Full ECR repository URL used for docker tag/push."
  value       = aws_ecr_repository.app.repository_url
}

output "region" {
  value = var.region
}
