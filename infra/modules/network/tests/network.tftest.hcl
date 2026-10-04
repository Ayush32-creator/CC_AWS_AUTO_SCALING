# Plan-only tests for the network module (mock provider: no AWS calls).

mock_provider "aws" {
  override_during = plan
}

# Pin subnet IDs so the instance-subnet selection logic can be checked.
override_resource {
  target          = aws_subnet.public
  override_during = plan
  values          = { id = "subnet-public" }
}

override_resource {
  target          = aws_subnet.app
  override_during = plan
  values          = { id = "subnet-app" }
}

variables {
  name                = "cc-checkout-dev"
  region              = "ap-southeast-2"
  vpc_cidr            = "10.0.0.0/16"
  azs                 = ["ap-southeast-2a", "ap-southeast-2b"]
  public_subnet_cidrs = ["10.0.1.0/24", "10.0.2.0/24"]
  app_subnet_cidrs    = ["10.0.11.0/24", "10.0.12.0/24"]
  db_subnet_cidrs     = ["10.0.21.0/24", "10.0.22.0/24"]
  enable_nat_gateway  = true
}

run "three_tiers_across_two_azs" {
  command = plan

  assert {
    condition     = [for s in aws_subnet.public : s.availability_zone] == ["ap-southeast-2a", "ap-southeast-2b"]
    error_message = "Public subnets must span both AZs."
  }

  assert {
    condition = (
      [for s in aws_subnet.app : s.cidr_block] == ["10.0.11.0/24", "10.0.12.0/24"] &&
      [for s in aws_subnet.db : s.cidr_block] == ["10.0.21.0/24", "10.0.22.0/24"]
    )
    error_message = "Subnet CIDRs do not match the documented design."
  }

  assert {
    condition     = alltrue([for s in aws_subnet.public : s.map_public_ip_on_launch == false])
    error_message = "Public IPs must not be auto-assigned; the launch template decides."
  }
}

run "routing_with_nat" {
  command = plan

  assert {
    condition     = aws_route.public_internet.destination_cidr_block == "0.0.0.0/0"
    error_message = "Public route table needs a default route to the IGW."
  }

  assert {
    condition     = length(aws_nat_gateway.this) == 1 && length(aws_route.app_nat) == 1
    error_message = "One NAT Gateway and an app default route via NAT are expected."
  }

  assert {
    condition     = output.instance_subnet_ids == ["subnet-app", "subnet-app"] && output.instances_need_public_ip == false
    error_message = "With NAT, instances must run in the private app subnets without public IPs."
  }

  assert {
    condition     = aws_vpc_endpoint.s3.vpc_endpoint_type == "Gateway" && aws_vpc_endpoint.s3.service_name == "com.amazonaws.ap-southeast-2.s3"
    error_message = "A free S3 gateway endpoint is expected."
  }
}

run "routing_without_nat" {
  command = plan

  variables {
    enable_nat_gateway = false
  }

  assert {
    condition     = length(aws_nat_gateway.this) == 0 && length(aws_eip.nat) == 0 && length(aws_route.app_nat) == 0
    error_message = "No NAT resources may exist when NAT is disabled."
  }

  assert {
    condition     = output.instance_subnet_ids == ["subnet-public", "subnet-public"] && output.instances_need_public_ip
    error_message = "Without NAT, instances must run in public subnets with public IPs."
  }
}

run "rejects_cidr_count_mismatch" {
  command = plan

  variables {
    app_subnet_cidrs = ["10.0.11.0/24"]
  }

  expect_failures = [var.app_subnet_cidrs]
}

run "rejects_single_az" {
  command = plan

  variables {
    azs                 = ["ap-southeast-2a"]
    public_subnet_cidrs = ["10.0.1.0/24"]
    app_subnet_cidrs    = ["10.0.11.0/24"]
    db_subnet_cidrs     = ["10.0.21.0/24"]
  }

  expect_failures = [var.azs]
}
