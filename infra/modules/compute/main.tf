# Launch template + Auto Scaling Group + target-tracking scaling policies.

# Latest Amazon Linux 2023 AMI, resolved from AWS's public SSM parameter so
# no AMI ID is hard-coded (AMI IDs differ per region and change monthly).
data "aws_ssm_parameter" "al2023_ami" {
  name = var.ami_ssm_parameter
}

locals {
  registry = split("/", var.ecr_repository_url)[0]

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    region              = var.region
    registry            = local.registry
    image_uri           = "${var.ecr_repository_url}:${var.image_tag}"
    image_tag           = var.image_tag
    app_port            = var.app_port
    log_group           = var.log_group_name
    db_host             = var.db_host
    db_port             = var.db_port
    db_name             = var.db_name
    db_user             = var.db_user
    db_secret_arn       = var.db_secret_arn
    db_pool_max         = var.db_pool_max
    container_memory_mb = var.container_memory_mb
  })
}

resource "aws_launch_template" "this" {
  name                   = "${var.name}-lt"
  description            = "Checkout app on Amazon Linux 2023 + Docker"
  image_id               = data.aws_ssm_parameter.al2023_ami.insecure_value # public AMI ID, not a secret
  instance_type          = var.instance_type
  update_default_version = true
  user_data              = base64encode(local.user_data)

  iam_instance_profile {
    arn = aws_iam_instance_profile.instance.arn
  }

  network_interfaces {
    # Public IP only when there is no NAT Gateway (see network module).
    associate_public_ip_address = var.associate_public_ip
    security_groups             = [var.security_group_id]
    delete_on_termination       = true
  }

  # IMDSv2 only (blocks SSRF-style credential theft). Hop limit 2 lets the
  # Docker container reach the metadata service through the bridge network
  # to obtain instance-role credentials and the instance ID.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  # 1-minute EC2 metrics so CPU-based scaling reacts quickly.
  monitoring {
    enabled = true
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = var.root_volume_gb
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.name}-app" }
  }

  tag_specifications {
    resource_type = "volume"
    tags          = { Name = "${var.name}-app-root" }
  }
}

resource "aws_autoscaling_group" "this" {
  name                = "${var.name}-asg"
  vpc_zone_identifier = var.subnet_ids
  target_group_arns   = [var.target_group_arn]

  min_size         = var.min_size
  max_size         = var.max_size
  desired_capacity = var.desired_capacity

  # Replace instances the ALB marks unhealthy, not just failed VMs.
  health_check_type         = "ELB"
  health_check_grace_period = var.health_check_grace_seconds
  # New instances are excluded from scaling metrics until warmed up, so a
  # booting instance does not distort the average and trigger extra scaling.
  default_instance_warmup = var.instance_warmup_seconds

  launch_template {
    id      = aws_launch_template.this.id
    version = aws_launch_template.this.latest_version
  }

  # Changing the launch template (e.g. a new image_tag) triggers a rolling
  # replacement that keeps at least half the instances serving traffic.
  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
      skip_matching          = true
    }
  }

  # Publish group metrics (InService, Desired, ...) to CloudWatch - free.
  enabled_metrics = [
    "GroupDesiredCapacity",
    "GroupInServiceInstances",
    "GroupPendingInstances",
    "GroupTerminatingInstances",
    "GroupMinSize",
    "GroupMaxSize",
  ]

  tag {
    key                 = "Name"
    value               = "${var.name}-app"
    propagate_at_launch = true
  }

  lifecycle {
    # The scaling policies own desired_capacity at runtime; without this,
    # every `terraform apply` would reset the instance count.
    ignore_changes = [desired_capacity]
  }
}

# --------------------------------------------------------------------------
# Target-tracking scaling. The ASG scales OUT if either policy is above its
# target, and scales IN only when both are comfortably below.
# --------------------------------------------------------------------------
resource "aws_autoscaling_policy" "requests_per_target" {
  name                   = "${var.name}-requests-per-target"
  autoscaling_group_name = aws_autoscaling_group.this.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${var.alb_arn_suffix}/${var.target_group_arn_suffix}"
    }
    target_value = var.target_requests_per_instance_per_minute
  }
}

resource "aws_autoscaling_policy" "cpu" {
  name                   = "${var.name}-cpu"
  autoscaling_group_name = aws_autoscaling_group.this.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = var.target_cpu_percent
  }
}
