# ---- General -------------------------------------------------------------
variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "project" {
  type    = string
  default = "cc-checkout"
}

variable "environment" {
  type    = string
  default = "dev"
}

# ---- Network (docs/01-architecture.md §3) ----------------------------------
variable "azs" {
  type    = list(string)
  default = ["ap-south-1a", "ap-south-1b"]
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "app_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.11.0/24", "10.0.12.0/24"]
}

variable "db_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.21.0/24", "10.0.22.0/24"]
}

variable "enable_nat_gateway" {
  description = "true = instances in private subnets behind a NAT Gateway (~$0.056/h). false = public subnets, cheaper."
  type        = bool
  default     = true
}

variable "alb_ingress_cidrs" {
  description = "Who may reach the ALB. Default is the whole internet; use [\"<your-ip>/32\"] to restrict."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ---- Application -------------------------------------------------------------
variable "ecr_repository_name" {
  description = "ECR repository created by the bootstrap stack."
  type        = string
  default     = "cc-checkout"
}

variable "image_tag" {
  description = "Image tag to deploy (git commit SHA). Changing it triggers a rolling instance refresh."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", var.image_tag)) && var.image_tag != "latest"
    error_message = "image_tag must be a valid Docker tag and not \"latest\" (the repository uses immutable tags)."
  }
}

variable "app_port" {
  type    = number
  default = 3000
}

variable "artifacts_bucket_name" {
  description = "Bootstrap artifacts bucket for ALB access logs (null = no access logs)."
  type        = string
  default     = null
}

# ---- Compute / scaling ---------------------------------------------------------
variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "asg_min_size" {
  type    = number
  default = 1
}

variable "asg_desired_capacity" {
  type    = number
  default = 2

  validation {
    condition     = var.asg_desired_capacity >= var.asg_min_size && var.asg_desired_capacity <= var.asg_max_size
    error_message = "asg_desired_capacity must be between asg_min_size and asg_max_size."
  }
}

variable "asg_max_size" {
  type    = number
  default = 4

  validation {
    condition     = var.asg_max_size <= 6
    error_message = "asg_max_size above 6 is not needed for this project and risks unexpected cost."
  }
}

variable "target_requests_per_instance_per_minute" {
  type    = number
  default = 300
}

variable "target_cpu_percent" {
  type    = number
  default = 60
}

variable "db_pool_max" {
  description = "DB connections per instance."
  type        = number
  default     = 10

  validation {
    # db.t4g.micro allows roughly 80 connections; keep headroom for admin/RDS.
    condition     = var.db_pool_max * var.asg_max_size <= 60
    error_message = "db_pool_max x asg_max_size must not exceed 60 connections for db.t4g.micro."
  }
}

# ---- Database --------------------------------------------------------------------
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "log_retention_days" {
  type    = number
  default = 7
}
