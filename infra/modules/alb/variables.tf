variable "name" {
  description = "Name prefix (ALB/target group names are limited to 32 characters)."
  type        = string

  validation {
    condition     = length(var.name) <= 28
    error_message = "name must be at most 28 characters so \"<name>-alb\" fits the 32-character limit."
  }
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  description = "Public subnets in at least two AZs."
  type        = list(string)
}

variable "security_group_id" {
  type = string
}

variable "app_port" {
  type = number
}

variable "access_logs_bucket" {
  description = "S3 bucket for ALB access logs (null disables them)."
  type        = string
  default     = null
}
