variable "name" {
  description = "Name prefix."
  type        = string
}

variable "region" {
  type = string
}

# ---- Placement / networking ----------------------------------------------
variable "subnet_ids" {
  description = "Subnets the ASG launches instances into (one per AZ)."
  type        = list(string)
}

variable "security_group_id" {
  type = string
}

variable "associate_public_ip" {
  description = "Give instances a public IP (only when there is no NAT Gateway)."
  type        = bool
}

variable "target_group_arn" {
  type = string
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_group_arn_suffix" {
  type = string
}

# ---- Instance ----------------------------------------------------------------
variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "ami_ssm_parameter" {
  description = "Public SSM parameter that resolves to the latest AMI."
  type        = string
  default     = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

variable "root_volume_gb" {
  type    = number
  default = 8
}

variable "container_memory_mb" {
  description = "Hard memory limit for the app container (t3.micro has 1 GiB)."
  type        = number
  default     = 640
}

# ---- Application -------------------------------------------------------------
variable "ecr_repository_url" {
  type = string
}

variable "ecr_repository_arn" {
  type = string
}

variable "image_tag" {
  type = string
}

variable "app_port" {
  type = number
}

variable "log_group_name" {
  type = string
}

variable "log_group_arn" {
  type = string
}

variable "db_host" {
  type = string
}

variable "db_port" {
  type = number
}

variable "db_name" {
  type = string
}

variable "db_user" {
  type = string
}

variable "db_secret_arn" {
  type = string
}

variable "db_pool_max" {
  description = "Connections per instance. max_size x db_pool_max must stay below the DB's max_connections."
  type        = number
  default     = 10
}

# ---- Scaling -------------------------------------------------------------------
variable "min_size" {
  type = number
}

variable "max_size" {
  type = number
}

variable "desired_capacity" {
  type = number

  validation {
    condition     = var.desired_capacity >= var.min_size && var.desired_capacity <= var.max_size
    error_message = "desired_capacity must be between min_size and max_size."
  }
}

variable "health_check_grace_seconds" {
  description = "Time after launch before failed ALB health checks count (boot + docker pull)."
  type        = number
  default     = 240
}

variable "instance_warmup_seconds" {
  type    = number
  default = 180
}

variable "target_requests_per_instance_per_minute" {
  description = "Target for ALBRequestCountPerTarget (requests per instance per minute)."
  type        = number
  default     = 300
}

variable "target_cpu_percent" {
  type    = number
  default = 60
}
