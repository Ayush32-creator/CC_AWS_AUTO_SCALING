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

# ---- Resources to observe (CloudWatch dimensions) -------------------------
variable "region" {
  description = "AWS region (used in dashboard widgets)."
  type        = string
}

variable "alb_arn_suffix" {
  description = "ALB ARN suffix (LoadBalancer dimension)."
  type        = string
}

variable "target_group_arn_suffix" {
  description = "Target group ARN suffix (TargetGroup dimension)."
  type        = string
}

variable "asg_name" {
  description = "Auto Scaling Group name (AutoScalingGroupName dimension)."
  type        = string
}

variable "db_instance_identifier" {
  description = "RDS instance identifier (DBInstanceIdentifier dimension)."
  type        = string
}

# ---- Alarm thresholds (docs/01-architecture.md §5-6) -----------------------
variable "alarm_5xx_rate_percent" {
  description = "Alarm when ALB + target 5xx responses exceed this % of requests (evaluated only with >= 10 requests/min)."
  type        = number
  default     = 5
}

variable "alarm_p95_latency_seconds" {
  description = "Alarm when p95 TargetResponseTime exceeds this many seconds."
  type        = number
  default     = 1
}

variable "alarm_rds_cpu_percent" {
  description = "Alarm when average RDS CPU exceeds this %."
  type        = number
  default     = 80
}

variable "alarm_email" {
  description = "Email address for alarm notifications via SNS (AWS sends a confirmation link). null = alarms are visible in CloudWatch only; no SNS topic is created."
  type        = string
  default     = null

  validation {
    condition     = var.alarm_email == null || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alarm_email))
    error_message = "alarm_email must be a valid email address or null."
  }
}
