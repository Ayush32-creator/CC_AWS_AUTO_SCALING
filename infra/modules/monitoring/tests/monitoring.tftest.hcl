# Plan-only tests for the monitoring module (mock provider: no AWS calls).

mock_provider "aws" {
  # Generate mock ARNs during plan so the dashboard body can be inspected.
  override_during = plan

  mock_resource "aws_cloudwatch_metric_alarm" {
    defaults = {
      arn = "arn:aws:cloudwatch:ap-southeast-2:123456789012:alarm:mock"
    }
  }
}

variables {
  project                 = "cc-checkout"
  environment             = "dev"
  region                  = "ap-southeast-2"
  alb_arn_suffix          = "app/cc-checkout-dev-alb/42ff5e47cbbde43d"
  target_group_arn_suffix = "targetgroup/cc-checkout-dev-tg/84ff7b66b5e4ab01"
  asg_name                = "cc-checkout-dev-asg"
  db_instance_identifier  = "cc-checkout-dev-postgres"
}

run "metric_filters_match_app_log_events" {
  command = plan

  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.this) == 4
    error_message = "Expected OrdersPlaced, OrdersFailed, CheckoutLatency and AppErrors filters."
  }

  assert {
    condition = alltrue([
      for f in aws_cloudwatch_log_metric_filter.this : f.log_group_name == "/cc-checkout/dev/app" && f.metric_transformation[0].namespace == "cc-checkout/dev"
    ])
    error_message = "All filters must read the app log group and publish to the cc-checkout/dev namespace."
  }

  assert {
    condition     = strcontains(aws_cloudwatch_log_metric_filter.this["orders_placed"].pattern, "$.outcome = \"paid\"") && strcontains(aws_cloudwatch_log_metric_filter.this["orders_failed"].pattern, "$.outcome = \"declined\"")
    error_message = "OrdersPlaced/OrdersFailed must match the paid/declined checkout outcomes."
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.this["checkout_latency"].metric_transformation[0].value == "$.latencyMs" && aws_cloudwatch_log_metric_filter.this["checkout_latency"].metric_transformation[0].default_value == null && !strcontains(aws_cloudwatch_log_metric_filter.this["checkout_latency"].pattern, "replayed")
    error_message = "CheckoutLatency must use latencyMs, exclude replays and have no default value (keeps percentiles honest)."
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.this["app_errors"].pattern == "{ $.level >= 50 }"
    error_message = "AppErrors must count pino error (50) and fatal (60) lines."
  }
}

run "alarms_watch_user_facing_symptoms" {
  command = plan

  assert {
    condition     = aws_cloudwatch_metric_alarm.no_healthy_targets.metric_name == "HealthyHostCount" && aws_cloudwatch_metric_alarm.no_healthy_targets.comparison_operator == "LessThanThreshold" && aws_cloudwatch_metric_alarm.no_healthy_targets.threshold == 1 && aws_cloudwatch_metric_alarm.no_healthy_targets.dimensions.TargetGroup == "targetgroup/cc-checkout-dev-tg/84ff7b66b5e4ab01"
    error_message = "The outage alarm must fire when the target group has fewer than 1 healthy host."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.p95_latency.extended_statistic == "p95" && aws_cloudwatch_metric_alarm.p95_latency.threshold == 1
    error_message = "Latency alarm must use p95 TargetResponseTime with a 1 s threshold."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.rds_cpu.threshold == 80 && aws_cloudwatch_metric_alarm.rds_cpu.dimensions.DBInstanceIdentifier == "cc-checkout-dev-postgres"
    error_message = "RDS CPU alarm must watch the dev DB at 80%."
  }

  assert {
    condition     = anytrue([for q in aws_cloudwatch_metric_alarm.alb_5xx_rate.metric_query : q.return_data == true && strcontains(q.expression, ">= 10")])
    error_message = "5xx-rate alarm must ignore minutes with fewer than 10 requests."
  }

  assert {
    condition     = alltrue([for a in [aws_cloudwatch_metric_alarm.alb_5xx_rate, aws_cloudwatch_metric_alarm.no_healthy_targets, aws_cloudwatch_metric_alarm.p95_latency, aws_cloudwatch_metric_alarm.rds_cpu] : a.treat_missing_data == "notBreaching"])
    error_message = "Missing data (e.g. no traffic) must not trigger alarms."
  }
}

run "no_sns_topic_by_default" {
  command = plan

  assert {
    condition     = length(aws_sns_topic.alarms) == 0 && length(aws_sns_topic_subscription.alarm_email) == 0 && length(aws_cloudwatch_metric_alarm.rds_cpu.alarm_actions) == 0
    error_message = "Without alarm_email, no SNS resources or alarm actions may be created."
  }
}

run "sns_email_when_configured" {
  command = plan

  variables {
    alarm_email = "ops@example.com"
  }

  assert {
    condition     = length(aws_sns_topic.alarms) == 1 && aws_sns_topic_subscription.alarm_email[0].protocol == "email" && aws_sns_topic_subscription.alarm_email[0].endpoint == "ops@example.com"
    error_message = "alarm_email must create one SNS topic with an email subscription."
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.no_healthy_targets.alarm_actions) == 1 && length(aws_cloudwatch_metric_alarm.no_healthy_targets.ok_actions) == 1
    error_message = "Alarms must notify the SNS topic on ALARM and OK."
  }
}

run "rejects_invalid_email" {
  command = plan

  variables {
    alarm_email = "not-an-email"
  }

  expect_failures = [var.alarm_email]
}

run "dashboard_covers_scaling_traffic_db_and_orders" {
  command = plan

  assert {
    condition     = length(jsondecode(aws_cloudwatch_dashboard.this.dashboard_body).widgets) == 13
    error_message = "Expected 12 metric widgets plus the alarm overview."
  }

  assert {
    condition     = length([for w in jsondecode(aws_cloudwatch_dashboard.this.dashboard_body).widgets : w if w.type == "alarm" && length(w.properties.alarms) == 4]) == 1
    error_message = "The alarm overview widget must list all four alarms."
  }

  assert {
    condition     = strcontains(aws_cloudwatch_dashboard.this.dashboard_body, "cc-checkout-dev-asg") && strcontains(aws_cloudwatch_dashboard.this.dashboard_body, "OrdersPlaced") && strcontains(aws_cloudwatch_dashboard.this.dashboard_body, "cc-checkout-dev-postgres")
    error_message = "Dashboard must reference the ASG, the custom order metrics and the RDS instance."
  }
}
