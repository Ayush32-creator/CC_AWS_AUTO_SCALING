# Chained security groups (docs/01-architecture.md §3):
#   Internet --80--> alb-sg --app_port--> app-sg --5432--> db-sg
# Each tier accepts traffic only from the tier in front of it, referenced by
# security-group ID rather than CIDR, so the rules stay correct as instances
# come and go during scaling.

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb-sg"
  description = "Application Load Balancer: HTTP from allowed CIDRs"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-alb-sg" }
}

resource "aws_security_group" "app" {
  name        = "${var.name}-app-sg"
  description = "App instances: traffic only from the ALB"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-app-sg" }
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db-sg"
  description = "RDS PostgreSQL: traffic only from app instances"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-db-sg" }
}

# ---- ALB -------------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each = toset(var.alb_ingress_cidrs)

  security_group_id = aws_security_group.alb.id
  description       = "HTTP from ${each.value}"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward requests and health checks to app instances"
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.app.id
}

# ---- App instances --------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "App port from the ALB only"
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.alb.id
}

# HTTPS out: ECR, Secrets Manager, CloudWatch Logs, SSM (Session Manager)
# and Amazon Linux package repositories. These are public AWS endpoints, so
# a CIDR of 0.0.0.0/0 is required without paid VPC interface endpoints.
# (DNS, NTP and instance metadata are not filtered by security groups.)
#trivy:ignore:AVD-AWS-0104
resource "aws_vpc_security_group_egress_rule" "app_https" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS to AWS APIs and package repositories"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = aws_security_group.app.id
  description                  = "PostgreSQL to RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.db.id
}

# ---- Database -------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from app instances only"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.app.id
}
# No egress rules on db-sg: security groups are stateful, so replies to
# allowed inbound connections still flow; RDS never initiates connections.
