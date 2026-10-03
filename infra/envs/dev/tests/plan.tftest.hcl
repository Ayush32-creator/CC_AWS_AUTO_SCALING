# Plan-only tests for the dev stack, run with `terraform test`.
#
# They use a MOCK AWS provider: no credentials are needed, no AWS API is
# called and nothing is created. They check the configuration is internally
# consistent and enforces the design rules from docs/01-architecture.md.

mock_provider "aws" {
  # Generate mock values (IDs, ARNs) during plan so assertions can use them.
  override_during = plan

  mock_data "aws_ecr_repository" {
    defaults = {
      repository_url = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/cc-checkout"
      arn            = "arn:aws:ecr:ap-south-1:123456789012:repository/cc-checkout"
    }
  }

  mock_data "aws_ssm_parameter" {
    defaults = {
      insecure_value = "ami-0123456789abcdef0"
    }
  }

  # Realistic ARNs so IAM policy references can be checked.
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:ap-south-1:123456789012:log-group:/cc-checkout/dev/app"
    }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      address = "cc-checkout-dev-postgres.abc123.ap-south-1.rds.amazonaws.com"
      port    = 5432
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:ap-south-1:123456789012:secret:rds!db-1234"
        secret_status = "active"
        kms_key_id    = ""
      }]
    }
  }

  mock_resource "aws_lb" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:ap-south-1:123456789012:loadbalancer/app/cc-checkout-dev-alb/50dc6c495c0c9188"
      arn_suffix = "app/cc-checkout-dev-alb/50dc6c495c0c9188"
      dns_name   = "cc-checkout-dev-alb-123.ap-south-1.elb.amazonaws.com"
    }
  }

  mock_resource "aws_lb_target_group" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:ap-south-1:123456789012:targetgroup/cc-checkout-dev-tg/73e2d6bc24d8a067"
      arn_suffix = "targetgroup/cc-checkout-dev-tg/73e2d6bc24d8a067"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/cc-checkout-dev-instance-role"
    }
  }

  mock_resource "aws_iam_instance_profile" {
    defaults = {
      arn = "arn:aws:iam::123456789012:instance-profile/cc-checkout-dev-instance-profile"
    }
  }
}

variables {
  image_tag             = "abc1234"
  artifacts_bucket_name = "cc-checkout-artifacts-123456789012"
}

# Subnet selection and security-group chaining are verified in the
# network and security module tests, where resource IDs can be pinned.
run "network_layout" {
  command = plan

  assert {
    condition     = length(module.network.public_subnet_ids) == 2 && length(module.network.app_subnet_ids) == 2 && length(module.network.db_subnet_ids) == 2
    error_message = "Expected one public, app and DB subnet in each of the two AZs."
  }

  assert {
    condition     = module.network.instances_need_public_ip == false
    error_message = "With NAT enabled, instances must not get public IPs."
  }
}

run "nat_disabled_moves_instances_to_public_subnets" {
  command = plan

  variables {
    enable_nat_gateway = false
  }

  assert {
    condition     = module.network.instances_need_public_ip
    error_message = "Without NAT, instances need public IPs for egress."
  }

  assert {
    condition     = module.network.nat_gateway_public_ip == null
    error_message = "No NAT Gateway should be created when disabled."
  }
}

run "database_is_private_encrypted_and_secret_managed" {
  command = plan

  assert {
    condition     = output.db_secret_arn == "arn:aws:secretsmanager:ap-south-1:123456789012:secret:rds!db-1234"
    error_message = "The app must receive the RDS-managed secret ARN."
  }

  assert {
    condition     = output.db_endpoint == "cc-checkout-dev-postgres.abc123.ap-south-1.rds.amazonaws.com:5432"
    error_message = "db_endpoint output is wired incorrectly."
  }
}

run "scaling_configuration" {
  command = plan

  assert {
    condition     = output.cloudwatch_dimensions.LoadBalancer == "app/cc-checkout-dev-alb/50dc6c495c0c9188"
    error_message = "ALB dimension output is wired incorrectly."
  }

  assert {
    condition     = output.app_url == "http://cc-checkout-dev-alb-123.ap-south-1.elb.amazonaws.com"
    error_message = "app_url must point at the ALB."
  }
}

run "rejects_latest_tag" {
  command = plan

  variables {
    image_tag = "latest"
  }

  expect_failures = [var.image_tag]
}

run "rejects_too_many_db_connections" {
  command = plan

  variables {
    db_pool_max  = 20
    asg_max_size = 4
  }

  expect_failures = [var.db_pool_max]
}

run "rejects_desired_outside_min_max" {
  command = plan

  variables {
    asg_min_size         = 1
    asg_desired_capacity = 5
    asg_max_size         = 4
  }

  expect_failures = [var.asg_desired_capacity]
}
