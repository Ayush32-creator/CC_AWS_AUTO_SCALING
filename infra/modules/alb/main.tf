# Internet-facing Application Load Balancer in the public subnets, with one
# HTTP listener forwarding to a target group that the Auto Scaling Group
# registers its instances into.

# Accepted: a public e-commerce site must be internet-facing (access can be
# narrowed with alb_ingress_cidrs).
#trivy:ignore:AVD-AWS-0053
resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = var.public_subnet_ids
  security_groups    = [var.security_group_id]

  idle_timeout               = 60   # the app's keep-alive (65 s) is longer, avoiding 502s
  drop_invalid_header_fields = true # reject malformed headers (request smuggling defence)
  enable_deletion_protection = false

  dynamic "access_logs" {
    for_each = var.access_logs_bucket == null ? [] : [1]
    content {
      bucket  = var.access_logs_bucket
      prefix  = "alb-logs"
      enabled = true
    }
  }
}

resource "aws_lb_target_group" "app" {
  name        = "${var.name}-tg"
  port        = var.app_port
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = var.vpc_id

  # Give in-flight checkouts time to finish when an instance is removed
  # (scale-in / instance refresh). Matches the app's graceful shutdown.
  deregistration_delay = 30

  health_check {
    # Liveness only - see docs/01-architecture.md for why the DB is excluded.
    path                = "/api/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# Accepted for dev: HTTPS needs an ACM certificate for a domain we own; no card
# data is real (mock payments). Documented as a production requirement.
#trivy:ignore:AVD-AWS-0054
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
