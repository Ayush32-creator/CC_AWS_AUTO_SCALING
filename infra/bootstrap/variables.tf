variable "region" {
  description = "AWS region for all project resources."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Project name used as a prefix for resource names."
  type        = string
  default     = "cc-checkout"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,20}$", var.project))
    error_message = "project must be 3-21 lowercase letters, digits or hyphens."
  }
}

variable "budget_limit_usd" {
  description = "Monthly cost budget in USD. Alerts fire at 50% forecast and 100% actual."
  type        = number
  default     = 10
}

variable "budget_alert_emails" {
  description = "Email addresses for budget alerts. Empty list = no budget is created."
  type        = list(string)
  default     = []
}

variable "ecr_keep_last_images" {
  description = "Number of most recent images kept in ECR; older ones are expired."
  type        = number
  default     = 5
}

variable "allow_destroy_with_data" {
  description = "Allow `terraform destroy` to delete non-empty buckets/repositories. Keep false until final project cleanup."
  type        = bool
  default     = false
}
