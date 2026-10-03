# Plan-only tests for the compute module with a mock provider (no AWS calls).
# They inspect the rendered launch template, ASG and IAM policy directly.

mock_provider "aws" {
  mock_data "aws_ssm_parameter" {
    defaults = {
      insecure_value = "ami-0123456789abcdef0"
    }
  }
}

variables {
  name                    = "cc-checkout-dev"
  region                  = "ap-south-1"
  subnet_ids              = ["subnet-a", "subnet-b"]
  security_group_id       = "sg-app"
  associate_public_ip     = false
  target_group_arn        = "arn:aws:elasticloadbalancing:ap-south-1:123456789012:targetgroup/cc-checkout-dev-tg/73e2d6bc24d8a067"
  alb_arn_suffix          = "app/cc-checkout-dev-alb/50dc6c495c0c9188"
  target_group_arn_suffix = "targetgroup/cc-checkout-dev-tg/73e2d6bc24d8a067"
  ecr_repository_url      = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/cc-checkout"
  ecr_repository_arn      = "arn:aws:ecr:ap-south-1:123456789012:repository/cc-checkout"
  image_tag               = "abc1234"
  app_port                = 3000
  log_group_name          = "/cc-checkout/dev/app"
  log_group_arn           = "arn:aws:logs:ap-south-1:123456789012:log-group:/cc-checkout/dev/app"
  db_host                 = "db.internal"
  db_port                 = 5432
  db_name                 = "checkout"
  db_user                 = "checkout_admin"
  db_secret_arn           = "arn:aws:secretsmanager:ap-south-1:123456789012:secret:rds!db-1234"
  min_size                = 1
  desired_capacity        = 2
  max_size                = 4
}

run "launch_template_hardening" {
  command = plan

  assert {
    condition     = aws_launch_template.this.metadata_options[0].http_tokens == "required"
    error_message = "IMDSv2 must be required."
  }

  assert {
    condition     = aws_launch_template.this.metadata_options[0].http_put_response_hop_limit == 2
    error_message = "Hop limit 2 is needed for the container to reach IMDS."
  }

  assert {
    condition     = aws_launch_template.this.block_device_mappings[0].ebs[0].encrypted == "true"
    error_message = "Root volumes must be encrypted."
  }

  assert {
    condition     = aws_launch_template.this.image_id == "ami-0123456789abcdef0"
    error_message = "AMI must come from the SSM parameter."
  }

  assert {
    condition     = aws_launch_template.this.network_interfaces[0].associate_public_ip_address == "false"
    error_message = "Private-subnet instances must not get public IPs."
  }
}

run "user_data_contains_no_secrets_and_correct_image" {
  command = plan

  assert {
    condition     = strcontains(local.user_data, "docker pull \"123456789012.dkr.ecr.ap-south-1.amazonaws.com/cc-checkout:abc1234\"")
    error_message = "User-data must pull the configured image tag."
  }

  assert {
    condition     = strcontains(local.user_data, "DB_SECRET_ARN=\"arn:aws:secretsmanager:ap-south-1:123456789012:secret:rds!db-1234\"")
    error_message = "User-data must pass the secret ARN (not a password)."
  }

  assert {
    condition     = !strcontains(lower(local.user_data), "db_password")
    error_message = "User-data must never contain a DB password."
  }

  assert {
    condition     = local.registry == "123456789012.dkr.ecr.ap-south-1.amazonaws.com"
    error_message = "ECR registry host parsed incorrectly."
  }
}

run "asg_and_scaling" {
  command = plan

  assert {
    condition     = aws_autoscaling_group.this.health_check_type == "ELB"
    error_message = "ASG must use ALB health checks."
  }

  assert {
    condition     = aws_autoscaling_group.this.min_size == 1 && aws_autoscaling_group.this.max_size == 4 && aws_autoscaling_group.this.desired_capacity == 2
    error_message = "ASG capacities wired incorrectly."
  }

  assert {
    condition     = aws_autoscaling_policy.requests_per_target.target_tracking_configuration[0].predefined_metric_specification[0].resource_label == "app/cc-checkout-dev-alb/50dc6c495c0c9188/targetgroup/cc-checkout-dev-tg/73e2d6bc24d8a067"
    error_message = "ALBRequestCountPerTarget resource label must be <alb-suffix>/<tg-suffix>."
  }

  assert {
    condition     = aws_autoscaling_policy.cpu.target_tracking_configuration[0].target_value == 60
    error_message = "CPU target should default to 60%."
  }
}

run "iam_policy_is_least_privilege" {
  command = plan

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.app.policy).Statement :
      s.Resource != "*" if s.Sid != "EcrAuthToken"
    ])
    error_message = "Only ecr:GetAuthorizationToken may use Resource \"*\"."
  }

  assert {
    condition = one([
      for s in jsondecode(aws_iam_role_policy.app.policy).Statement : s.Resource if s.Sid == "ReadDatabaseSecret"
    ]) == "arn:aws:secretsmanager:ap-south-1:123456789012:secret:rds!db-1234"
    error_message = "Secret access must be scoped to the single DB secret."
  }
}

run "public_ip_when_no_nat" {
  command = plan

  variables {
    associate_public_ip = true
  }

  assert {
    condition     = aws_launch_template.this.network_interfaces[0].associate_public_ip_address == "true"
    error_message = "Instances in public subnets need public IPs."
  }
}
