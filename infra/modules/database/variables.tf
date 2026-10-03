variable "name" {
  description = "Name prefix."
  type        = string
}

variable "subnet_ids" {
  description = "Private DB subnets (at least two AZs)."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group that only admits the app tier."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL version. A major version (\"16\") lets RDS pick the current default minor."
  type        = string
  default     = "16"
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage_gb" {
  description = "Storage size in GB (gp3, minimum 20)."
  type        = number
  default     = 20

  validation {
    condition     = var.allocated_storage_gb >= 20
    error_message = "gp3 storage must be at least 20 GB."
  }
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "checkout"
}

variable "master_username" {
  description = "Master user name (the password is generated and managed by RDS in Secrets Manager)."
  type        = string
  default     = "checkout_admin"
}

variable "multi_az" {
  description = "Standby replica in a second AZ. Roughly doubles DB cost; see the SLA section in docs."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Automated backup retention in days (0 disables backups)."
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Block deletion of the DB instance."
  type        = bool
  default     = false
}

variable "skip_final_snapshot" {
  description = "Skip the final snapshot on destroy (dev only; snapshots cost money after the project)."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "Retention for the exported PostgreSQL log group."
  type        = number
  default     = 7
}
