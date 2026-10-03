terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The bootstrap stack creates the S3 bucket that stores the *dev* stack's
  # state, so its own (small) state is kept locally in this directory.
  # terraform.tfstate is git-ignored: keep a backup copy of it.
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      Stack     = "bootstrap"
      ManagedBy = "terraform"
    }
  }
}
