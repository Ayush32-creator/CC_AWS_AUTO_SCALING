output "dns_name" {
  description = "Public DNS name of the ALB (the application URL)."
  value       = aws_lb.this.dns_name
}

output "arn_suffix" {
  description = "ALB ARN suffix (CloudWatch LoadBalancer dimension)."
  value       = aws_lb.this.arn_suffix
}

output "target_group_arn" {
  value = aws_lb_target_group.app.arn
}

output "target_group_arn_suffix" {
  description = "Target group ARN suffix (CloudWatch TargetGroup dimension)."
  value       = aws_lb_target_group.app.arn_suffix
}
