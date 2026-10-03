output "asg_name" {
  value = aws_autoscaling_group.this.name
}

output "launch_template_id" {
  value = aws_launch_template.this.id
}

output "instance_role_name" {
  value = aws_iam_role.instance.name
}

output "instance_role_arn" {
  value = aws_iam_role.instance.arn
}
