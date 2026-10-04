# Observability for the checkout service (docs/01-architecture.md §5):
#   * application log group (Phase 4)
#   * log metric filters -> custom metrics from the app's structured JSON logs
#   * one CloudWatch dashboard
#   * alarms for user-facing symptoms, with optional SNS email notification

locals {
  name      = "${var.project}-${var.environment}"
  namespace = "${var.project}/${var.environment}" # custom metrics, e.g. cc-checkout/dev

  alb_dims = { LoadBalancer = var.alb_arn_suffix }
  tg_dims  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.target_group_arn_suffix }
  rds_dims = { DBInstanceIdentifier = var.db_instance_identifier }

  alarm_actions = var.alarm_email == null ? [] : [aws_sns_topic.alarms[0].arn]
}

# Application container logs, shipped by Docker's awslogs driver with one
# log stream per EC2 instance.
# Accepted: CloudWatch-managed encryption; no payment or personal secrets are logged.
#trivy:ignore:AVD-AWS-0017
resource "aws_cloudwatch_log_group" "app" {
  name              = "/${var.project}/${var.environment}/app"
  retention_in_days = var.log_retention_days
}

# --------------------------------------------------------------------------
# Log metric filters
# --------------------------------------------------------------------------
# The app (pino) writes one JSON line per checkout, e.g.
#   {"level":30,"event":"checkout","outcome":"paid","latencyMs":412,...}
# outcome is paid | declined | replayed; replays carry no latencyMs.
# Metric filters turn these into metrics with no SDK calls or extra IAM.
locals {
  metric_filters = {
    orders_placed = {
      metric  = "OrdersPlaced"
      pattern = "{ ($.event = \"checkout\") && ($.outcome = \"paid\") }"
      value   = "1"
      default = 0
      unit    = "Count"
    }
    orders_failed = {
      metric  = "OrdersFailed" # payment declined or provider unavailable
      pattern = "{ ($.event = \"checkout\") && ($.outcome = \"declined\") }"
      value   = "1"
      default = 0
      unit    = "Count"
    }
    checkout_latency = {
      metric  = "CheckoutLatency" # end-to-end order placement time
      pattern = "{ ($.event = \"checkout\") && (($.outcome = \"paid\") || ($.outcome = \"declined\")) }"
      value   = "$.latencyMs"
      default = null # no value when there were no checkouts, so percentiles stay honest
      unit    = "Milliseconds"
    }
    app_errors = {
      metric  = "AppErrors" # pino level 50 (error) and 60 (fatal)
      pattern = "{ $.level >= 50 }"
      value   = "1"
      default = 0
      unit    = "Count"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "this" {
  for_each = local.metric_filters

  name           = "${local.name}-${each.value.metric}"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = each.value.pattern

  metric_transformation {
    namespace     = local.namespace
    name          = each.value.metric
    value         = each.value.value
    default_value = each.value.default
    unit          = each.value.unit
  }
}

# --------------------------------------------------------------------------
# Alarm notifications (optional)
# --------------------------------------------------------------------------
# Accepted: CloudWatch alarms cannot publish to a topic encrypted with the
# AWS-managed aws/sns key, and a customer-managed KMS key costs $1/month.
# Alarm messages contain only metric names and thresholds.
#trivy:ignore:AVD-AWS-0095
#trivy:ignore:AVD-AWS-0136
resource "aws_sns_topic" "alarms" {
  count = var.alarm_email == null ? 0 : 1
  name  = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# --------------------------------------------------------------------------
# Alarms: user-facing symptoms only. Scaling alarms are created and owned by
# the ASG target-tracking policies (modules/compute).
# --------------------------------------------------------------------------

# More than N% of requests fail with 5xx (ALB-generated or from the app).
# Evaluated only when there are >= 10 requests in the minute, so a single
# error at near-zero traffic does not page anyone.
resource "aws_cloudwatch_metric_alarm" "alb_5xx_rate" {
  alarm_name          = "${local.name}-alb-5xx-rate"
  alarm_description   = "More than ${var.alarm_5xx_rate_percent}% of requests returned 5xx in 3 of the last 5 minutes."
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.alarm_5xx_rate_percent
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  metric_query {
    id          = "rate"
    expression  = "IF(FILL(requests, 0) >= 10, 100 * (FILL(elb5xx, 0) + FILL(target5xx, 0)) / requests, 0)"
    label       = "5xx rate (%)"
    return_data = true
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = local.alb_dims
      stat        = "Sum"
      period      = 60
    }
  }

  metric_query {
    id = "elb5xx"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_ELB_5XX_Count"
      dimensions  = local.alb_dims
      stat        = "Sum"
      period      = 60
    }
  }

  metric_query {
    id = "target5xx"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = local.alb_dims
      stat        = "Sum"
      period      = 60
    }
  }
}

# No healthy target = the site is down. HealthyHostCount < 1 is used instead
# of UnHealthyHostCount > 0: a newly launched instance is reported unhealthy
# for ~2 minutes while it boots during every scale-out (docs/07 §3), which
# would make an UnHealthyHostCount alarm fire on normal scaling.
resource "aws_cloudwatch_metric_alarm" "no_healthy_targets" {
  alarm_name          = "${local.name}-no-healthy-targets"
  alarm_description   = "The ALB target group has had no healthy instance for 2 consecutive minutes (application outage)."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = local.tg_dims
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "p95_latency" {
  alarm_name          = "${local.name}-p95-latency"
  alarm_description   = "p95 target response time above ${var.alarm_p95_latency_seconds}s in 3 of the last 5 minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = local.alb_dims
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.alarm_p95_latency_seconds
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-cpu"
  alarm_description   = "RDS average CPU above ${var.alarm_rds_cpu_percent}% for 15 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = local.rds_dims
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.alarm_rds_cpu_percent
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# --------------------------------------------------------------------------
# Dashboard
# --------------------------------------------------------------------------
locals {
  # One widget = one graph; positions follow CloudWatch's 24-column grid.
  graph = { view = "timeSeries", stacked = false, region = var.region, period = 60 }

  widgets = [
    # Row 1: scaling and traffic
    { x = 0, y = 0, w = 8, h = 6, properties = merge(local.graph, {
      title = "ASG instances"
      metrics = [
        ["AWS/AutoScaling", "GroupInServiceInstances", "AutoScalingGroupName", var.asg_name, { stat = "Maximum", label = "In service" }],
        [".", "GroupDesiredCapacity", ".", ".", { stat = "Maximum", label = "Desired" }],
      ]
      yAxis = { left = { min = 0 } }
    }) },
    { x = 8, y = 0, w = 8, h = 6, properties = merge(local.graph, {
      title = "ALB requests per minute"
      metrics = [
        ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix, { stat = "Sum", label = "Total" }],
        [".", "RequestCountPerTarget", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.target_group_arn_suffix, { stat = "Sum", label = "Per target" }],
      ]
      annotations = { horizontal = [{ value = 300, label = "Scale-out target (300/target)" }] }
      yAxis       = { left = { min = 0 } }
    }) },
    { x = 16, y = 0, w = 8, h = 6, properties = merge(local.graph, {
      title = "Target health"
      metrics = [
        ["AWS/ApplicationELB", "HealthyHostCount", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.target_group_arn_suffix, { stat = "Minimum", label = "Healthy" }],
        [".", "UnHealthyHostCount", ".", ".", ".", ".", { stat = "Maximum", label = "Unhealthy" }],
      ]
      yAxis = { left = { min = 0 } }
    }) },

    # Row 2: latency, errors, compute
    { x = 0, y = 6, w = 8, h = 6, properties = merge(local.graph, {
      title = "Target response time (s)"
      metrics = [
        ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p50", label = "p50" }],
        ["...", { stat = "p95", label = "p95" }],
      ]
      annotations = { horizontal = [{ value = var.alarm_p95_latency_seconds, label = "p95 alarm" }] }
      yAxis       = { left = { min = 0 } }
    }) },
    { x = 8, y = 6, w = 8, h = 6, properties = merge(local.graph, {
      title = "HTTP errors per minute"
      metrics = [
        ["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", "LoadBalancer", var.alb_arn_suffix, { stat = "Sum", label = "ALB 5xx" }],
        [".", "HTTPCode_Target_5XX_Count", ".", ".", { stat = "Sum", label = "App 5xx" }],
        [".", "HTTPCode_Target_4XX_Count", ".", ".", { stat = "Sum", label = "App 4xx" }],
      ]
      yAxis = { left = { min = 0 } }
    }) },
    { x = 16, y = 6, w = 8, h = 6, properties = merge(local.graph, {
      title = "EC2 CPU (%)"
      metrics = [
        ["AWS/EC2", "CPUUtilization", "AutoScalingGroupName", var.asg_name, { stat = "Average", label = "Average" }],
        ["...", { stat = "Maximum", label = "Max" }],
      ]
      annotations = { horizontal = [{ value = 60, label = "CPU scaling target" }] }
      yAxis       = { left = { min = 0, max = 100 } }
    }) },

    # Row 3: database
    { x = 0, y = 12, w = 8, h = 6, properties = merge(local.graph, {
      title       = "RDS CPU (%)"
      metrics     = [["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_instance_identifier, { stat = "Average", label = "CPU" }]]
      annotations = { horizontal = [{ value = var.alarm_rds_cpu_percent, label = "Alarm" }] }
      yAxis       = { left = { min = 0, max = 100 } }
    }) },
    { x = 8, y = 12, w = 8, h = 6, properties = merge(local.graph, {
      title   = "RDS connections"
      metrics = [["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.db_instance_identifier, { stat = "Maximum", label = "Connections" }]]
      yAxis   = { left = { min = 0 } }
    }) },
    { x = 16, y = 12, w = 8, h = 6, properties = merge(local.graph, {
      title   = "RDS free storage (GB)"
      metrics = [[{ expression = "storage / 1000000000", label = "Free GB", id = "gb" }], ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", var.db_instance_identifier, { stat = "Minimum", id = "storage", visible = false }]]
      yAxis   = { left = { min = 0 } }
    }) },

    # Row 4: business metrics from the app's logs
    { x = 0, y = 18, w = 8, h = 6, properties = merge(local.graph, {
      title = "Orders per minute"
      metrics = [
        [local.namespace, "OrdersPlaced", { stat = "Sum", label = "Placed (paid)" }],
        [".", "OrdersFailed", { stat = "Sum", label = "Failed (declined)" }],
      ]
      yAxis = { left = { min = 0 } }
    }) },
    { x = 8, y = 18, w = 8, h = 6, properties = merge(local.graph, {
      title = "Checkout latency (ms)"
      metrics = [
        [local.namespace, "CheckoutLatency", { stat = "p50", label = "p50" }],
        ["...", { stat = "p95", label = "p95" }],
      ]
      annotations = { horizontal = [{ value = 500, label = "SLO p95 500 ms" }] }
      yAxis       = { left = { min = 0 } }
    }) },
    { x = 16, y = 18, w = 8, h = 6, properties = merge(local.graph, {
      title   = "Application errors (log level >= error)"
      metrics = [[local.namespace, "AppErrors", { stat = "Sum", label = "Errors" }]]
      yAxis   = { left = { min = 0 } }
    }) },

    # Row 5: alarm overview
    { x = 0, y = 24, w = 24, h = 3, type = "alarm", properties = {
      title = "Alarms"
      alarms = [
        aws_cloudwatch_metric_alarm.alb_5xx_rate.arn,
        aws_cloudwatch_metric_alarm.no_healthy_targets.arn,
        aws_cloudwatch_metric_alarm.p95_latency.arn,
        aws_cloudwatch_metric_alarm.rds_cpu.arn,
      ]
    } },
  ]
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = local.name
  dashboard_body = jsonencode({
    widgets = [for w in local.widgets : {
      type       = try(w.type, "metric")
      x          = w.x
      y          = w.y
      width      = w.w
      height     = w.h
      properties = w.properties
    }]
  })
}
