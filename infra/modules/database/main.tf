# RDS PostgreSQL in the private DB subnets.
#
# Credentials: manage_master_user_password = true makes RDS generate the
# master password and store it in AWS Secrets Manager. The password never
# appears in Terraform code, variables or state; the app reads it at runtime
# through its IAM role (see backend/src/db/secretPassword.js).

resource "aws_db_subnet_group" "this" {
  name        = "${var.name}-db-subnets"
  description = "Private DB subnets for ${var.name}"
  subnet_ids  = var.subnet_ids
}

resource "aws_db_parameter_group" "this" {
  name        = "${var.name}-pg16"
  family      = "postgres16"
  description = "PostgreSQL 16 settings for ${var.name}"

  # Refuse any non-TLS connection (encryption in transit).
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Log statements slower than 500 ms - useful during load testing.
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Accepted: auth uses an RDS-managed Secrets Manager password (not IAM DB auth);
# deletion protection is a variable (off in dev for clean teardown);
# Performance Insights is not needed at this scale.
#trivy:ignore:AVD-AWS-0176
#trivy:ignore:AVD-AWS-0177
#trivy:ignore:AVD-AWS-0133
resource "aws_db_instance" "this" {
  identifier     = "${var.name}-postgres"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name                     = var.db_name
  username                    = var.master_username
  manage_master_user_password = true

  allocated_storage = var.allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true # encryption at rest (AWS-managed KMS key, no extra cost)

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  port                   = 5432

  multi_az                = var.multi_az
  backup_retention_period = var.backup_retention_days
  backup_window           = "19:00-19:30" # 00:30-01:00 IST
  maintenance_window      = "sun:20:00-sun:20:30"

  auto_minor_version_upgrade = true
  apply_immediately          = true # dev: don't wait for the maintenance window

  # Ship PostgreSQL logs to CloudWatch Logs (slow queries, errors).
  enabled_cloudwatch_logs_exports = ["postgresql"]

  # Dev-friendly teardown; set deletion_protection = true for anything real.
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.name}-postgres-final"
  delete_automated_backups  = true
  copy_tags_to_snapshot     = true

  # Create the log group first, otherwise RDS creates it (without retention)
  # and Terraform fails with "already exists".
  depends_on = [aws_cloudwatch_log_group.postgres]
}

# RDS creates this log group on first export; owning it in Terraform sets a
# retention period (default would be "never expire") and deletes it on destroy.
# Accepted: logs are encrypted with the CloudWatch-managed key, not a paid CMK.
#trivy:ignore:AVD-AWS-0017
resource "aws_cloudwatch_log_group" "postgres" {
  name              = "/aws/rds/instance/${var.name}-postgres/postgresql"
  retention_in_days = var.log_retention_days
}
