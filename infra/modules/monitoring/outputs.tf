output "app_log_group_name" {
  value = aws_cloudwatch_log_group.app.name
}

output "app_log_group_arn" {
  value = aws_cloudwatch_log_group.app.arn
}

output "metric_namespace" {
  description = "CloudWatch namespace of the custom metrics derived from application logs."
  value       = local.namespace
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.this.dashboard_name
}

output "dashboard_url" {
  value = "https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards/dashboard/${aws_cloudwatch_dashboard.this.dashboard_name}"
}

output "alarm_names" {
  value = [
    aws_cloudwatch_metric_alarm.alb_5xx_rate.alarm_name,
    aws_cloudwatch_metric_alarm.no_healthy_targets.alarm_name,
    aws_cloudwatch_metric_alarm.p95_latency.alarm_name,
    aws_cloudwatch_metric_alarm.rds_cpu.alarm_name,
  ]
}

output "alarm_topic_arn" {
  description = "SNS topic for alarm emails (null when alarm_email is not set)."
  value       = var.alarm_email == null ? null : aws_sns_topic.alarms[0].arn
}
