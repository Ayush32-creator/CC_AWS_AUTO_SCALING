output "address" {
  description = "DNS name of the DB instance (private)."
  value       = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "master_username" {
  value = aws_db_instance.this.username
}

output "master_user_secret_arn" {
  description = "ARN of the RDS-managed Secrets Manager secret holding the master password."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "identifier" {
  description = "DB instance identifier (CloudWatch metric dimension DBInstanceIdentifier)."
  value       = aws_db_instance.this.identifier
}
