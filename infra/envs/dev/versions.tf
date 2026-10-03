terraform {
  required_version = ">= 1.10" # S3 native state locking (use_lockfile)

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Remote state in the bucket created by ../../bootstrap. The bucket name
  # contains the AWS account ID, so it is supplied at init time:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "envs/dev/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true # lock file in S3; no DynamoDB table needed
  }
}

provider "aws" {
  region = var.region

  # Every resource is tagged, so Cost Explorer can filter project spend.
  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
