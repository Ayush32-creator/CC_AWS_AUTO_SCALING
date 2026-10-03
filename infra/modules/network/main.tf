# Three-tier VPC across two Availability Zones (docs/01-architecture.md §3):
#   public       -> route 0.0.0.0/0 to the Internet Gateway  (ALB, NAT GW)
#   private-app  -> route 0.0.0.0/0 to the NAT Gateway       (EC2 instances)
#   private-db   -> local VPC routes only, no internet path  (RDS)

# Accepted: VPC Flow Logs cost CloudWatch ingestion; listed as a production add-on.
#trivy:ignore:AVD-AWS-0178
resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true # required for RDS endpoint and VPC endpoint DNS

  tags = { Name = "${var.name}-vpc" }
}

# Remove all rules from the VPC's default security group so nothing can
# accidentally use it (a common security benchmark finding).
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-default-unused" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-igw" }
}

# --------------------------------------------------------------------------
# Subnets
# --------------------------------------------------------------------------
resource "aws_subnet" "public" {
  count = length(var.azs)

  vpc_id            = aws_vpc.this.id
  availability_zone = var.azs[count.index]
  cidr_block        = var.public_subnet_cidrs[count.index]
  # Only instances placed here when NAT is disabled need public IPs; the
  # launch template decides that explicitly, so keep auto-assign off.
  map_public_ip_on_launch = false

  tags = { Name = "${var.name}-public-${var.azs[count.index]}", Tier = "public" }
}

resource "aws_subnet" "app" {
  count = length(var.azs)

  vpc_id            = aws_vpc.this.id
  availability_zone = var.azs[count.index]
  cidr_block        = var.app_subnet_cidrs[count.index]

  tags = { Name = "${var.name}-app-${var.azs[count.index]}", Tier = "private-app" }
}

resource "aws_subnet" "db" {
  count = length(var.azs)

  vpc_id            = aws_vpc.this.id
  availability_zone = var.azs[count.index]
  cidr_block        = var.db_subnet_cidrs[count.index]

  tags = { Name = "${var.name}-db-${var.azs[count.index]}", Tier = "private-db" }
}

# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-public-rt" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# A single NAT Gateway (in the first AZ) keeps cost down. A production setup
# would use one per AZ so an AZ outage cannot cut off the other AZ's egress.
resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? 1 : 0
  domain = "vpc"
  tags   = { Name = "${var.name}-nat-eip" }
}

resource "aws_nat_gateway" "this" {
  count = var.enable_nat_gateway ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${var.name}-nat" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "app" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-app-rt" }
}

resource "aws_route" "app_nat" {
  count = var.enable_nat_gateway ? 1 : 0

  route_table_id         = aws_route_table.app.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

resource "aws_route_table_association" "app" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.app.id
}

# DB tier: no default route at all; only intra-VPC traffic is possible.
resource "aws_route_table" "db" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-db-rt" }
}

resource "aws_route_table_association" "db" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.db[count.index].id
  route_table_id = aws_route_table.db.id
}

# S3 Gateway endpoint: free. ECR stores image layers in S3, so image pulls
# go over this endpoint instead of through the NAT Gateway (saving NAT
# data-processing charges). Attached to both app and public route tables
# because app instances live in public subnets when NAT is disabled.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.app.id, aws_route_table.public.id]
  tags              = { Name = "${var.name}-s3-endpoint" }
}
