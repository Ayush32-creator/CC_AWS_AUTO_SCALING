variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "log_retention_days" {
  description = "How long application logs are kept."
  type        = number
  default     = 7
}
