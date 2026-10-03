# Plan-only tests for the security module (mock provider: no AWS calls).
# Security-group IDs are pinned so the ALB -> app -> DB chain can be checked.

mock_provider "aws" {}

override_resource {
  target          = aws_security_group.alb
  override_during = plan
  values          = { id = "sg-alb" }
}

override_resource {
  target          = aws_security_group.app
  override_during = plan
  values          = { id = "sg-app" }
}

override_resource {
  target          = aws_security_group.db
  override_during = plan
  values          = { id = "sg-db" }
}

variables {
  name              = "cc-checkout-dev"
  vpc_id            = "vpc-123"
  app_port          = 3000
  alb_ingress_cidrs = ["0.0.0.0/0"]
}

run "tiers_are_chained_by_security_group" {
  command = plan

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_alb.referenced_security_group_id == "sg-alb" && aws_vpc_security_group_ingress_rule.app_from_alb.from_port == 3000
    error_message = "App instances must accept the app port only from the ALB security group."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.db_from_app.referenced_security_group_id == "sg-app" && aws_vpc_security_group_ingress_rule.db_from_app.from_port == 5432
    error_message = "The database must accept 5432 only from the app security group."
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.alb_to_app.referenced_security_group_id == "sg-app"
    error_message = "ALB egress must be limited to the app security group."
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.app_to_db.referenced_security_group_id == "sg-db"
    error_message = "App egress to PostgreSQL must be limited to the DB security group."
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.app_https.from_port == 443 && aws_vpc_security_group_egress_rule.app_https.to_port == 443
    error_message = "The only internet egress for app instances is HTTPS."
  }

  assert {
    condition     = keys(aws_vpc_security_group_ingress_rule.alb_http) == ["0.0.0.0/0"] && aws_vpc_security_group_ingress_rule.alb_http["0.0.0.0/0"].from_port == 80
    error_message = "ALB should accept HTTP on port 80 from the configured CIDRs."
  }
}

run "alb_can_be_restricted_to_one_ip" {
  command = plan

  variables {
    alb_ingress_cidrs = ["203.0.113.7/32"]
  }

  assert {
    condition     = keys(aws_vpc_security_group_ingress_rule.alb_http) == ["203.0.113.7/32"]
    error_message = "Restricting the ALB to a single IP must replace the open rule."
  }
}

run "rejects_invalid_cidr" {
  command = plan

  variables {
    alb_ingress_cidrs = ["not-a-cidr"]
  }

  expect_failures = [var.alb_ingress_cidrs]
}
