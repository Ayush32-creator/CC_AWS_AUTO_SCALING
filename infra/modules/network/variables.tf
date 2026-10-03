variable "name" {
  description = "Name prefix for all network resources."
  type        = string
}

variable "region" {
  description = "AWS region (used for the S3 endpoint service name)."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block of the VPC."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "azs" {
  description = "Availability Zones to use (ALB and RDS subnet groups need at least two)."
  type        = list(string)

  validation {
    condition     = length(var.azs) >= 2
    error_message = "At least two Availability Zones are required."
  }
}

variable "public_subnet_cidrs" {
  description = "One public subnet CIDR per AZ (ALB, NAT Gateway)."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidrs) == length(var.azs) && alltrue([for c in var.public_subnet_cidrs : can(cidrhost(c, 0))])
    error_message = "public_subnet_cidrs must contain one valid CIDR per Availability Zone."
  }
}

variable "app_subnet_cidrs" {
  description = "One private application subnet CIDR per AZ (EC2 instances)."
  type        = list(string)

  validation {
    condition     = length(var.app_subnet_cidrs) == length(var.azs) && alltrue([for c in var.app_subnet_cidrs : can(cidrhost(c, 0))])
    error_message = "app_subnet_cidrs must contain one valid CIDR per Availability Zone."
  }
}

variable "db_subnet_cidrs" {
  description = "One private database subnet CIDR per AZ (RDS)."
  type        = list(string)

  validation {
    condition     = length(var.db_subnet_cidrs) == length(var.azs) && alltrue([for c in var.db_subnet_cidrs : can(cidrhost(c, 0))])
    error_message = "db_subnet_cidrs must contain one valid CIDR per Availability Zone."
  }
}

variable "enable_nat_gateway" {
  description = "Create a NAT Gateway so instances can run in private subnets. false = instances use public subnets with public IPs (cheaper, still locked down by security groups)."
  type        = bool
}
