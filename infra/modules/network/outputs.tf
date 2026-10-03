output "vpc_id" {
  value = aws_vpc.this.id
}

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "app_subnet_ids" {
  description = "Private app subnets (only usable when NAT is enabled)."
  value       = aws_subnet.app[*].id
}

output "db_subnet_ids" {
  value = aws_subnet.db[*].id
}

output "instance_subnet_ids" {
  description = "Subnets the Auto Scaling Group should launch into, given the NAT setting."
  value       = var.enable_nat_gateway ? aws_subnet.app[*].id : aws_subnet.public[*].id
}

output "instances_need_public_ip" {
  description = "True when instances run in public subnets and need a public IP for egress."
  value       = !var.enable_nat_gateway
}

output "nat_gateway_public_ip" {
  value = var.enable_nat_gateway ? aws_eip.nat[0].public_ip : null
}
