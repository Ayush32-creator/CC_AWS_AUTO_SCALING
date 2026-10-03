output "app_url" {
  description = "Open this in a browser once instances are healthy."
  value       = "http://${module.alb.dns_name}"
}

output "asg_name" {
  description = "Auto Scaling Group name (for aws autoscaling CLI commands)."
  value       = module.compute.asg_name
}

output "app_log_group" {
  value = module.monitoring.app_log_group_name
}

output "db_endpoint" {
  description = "Private RDS endpoint (reachable only from the app tier)."
  value       = "${module.database.address}:${module.database.port}"
}

output "db_secret_arn" {
  description = "Secrets Manager secret holding the RDS master password (value is never output)."
  value       = module.database.master_user_secret_arn
}

output "nat_gateway_public_ip" {
  value = module.network.nat_gateway_public_ip
}

output "vpc_id" {
  value = module.network.vpc_id
}

# Used by Phase 5 (dashboards/alarms) and Phase 6 (load testing).
output "cloudwatch_dimensions" {
  value = {
    LoadBalancer         = module.alb.arn_suffix
    TargetGroup          = module.alb.target_group_arn_suffix
    AutoScalingGroupName = module.compute.asg_name
    DBInstanceIdentifier = module.database.identifier
  }
}
