# CloudWatch prerequisites for Phase 4. Dashboards, alarms and log metric
# filters (OrdersPlaced, OrdersFailed, CheckoutLatency) are added in Phase 5.

# Application container logs, shipped by Docker's awslogs driver with one
# log stream per EC2 instance.
# Accepted: CloudWatch-managed encryption; no payment or personal secrets are logged.
#trivy:ignore:AVD-AWS-0017
resource "aws_cloudwatch_log_group" "app" {
  name              = "/${var.project}/${var.environment}/app"
  retention_in_days = var.log_retention_days
}
