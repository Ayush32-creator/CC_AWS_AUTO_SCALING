variable "name" {
  description = "Name prefix."
  type        = string
}

variable "vpc_id" {
  description = "VPC in which to create the security groups."
  type        = string
}

variable "app_port" {
  description = "Port the application container listens on."
  type        = number
}

variable "alb_ingress_cidrs" {
  description = "CIDR blocks allowed to reach the ALB on port 80. Use [\"<your-ip>/32\"] to restrict testing to yourself."
  type        = list(string)

  validation {
    condition     = length(var.alb_ingress_cidrs) > 0 && alltrue([for c in var.alb_ingress_cidrs : can(cidrhost(c, 0))])
    error_message = "alb_ingress_cidrs must contain at least one valid IPv4 CIDR."
  }
}
