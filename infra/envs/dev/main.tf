# Dev environment: everything that is billed by the hour. Create it for a
# work session (`terraform apply`) and remove it afterwards (`terraform destroy`).
# Long-lived pieces (state bucket, ECR, budget) live in ../../bootstrap.

locals {
  name = "${var.project}-${var.environment}"
}

# ECR repository is owned by the bootstrap stack; look it up by name.
data "aws_ecr_repository" "app" {
  name = var.ecr_repository_name
}

module "network" {
  source = "../../modules/network"

  name                = local.name
  region              = var.region
  vpc_cidr            = var.vpc_cidr
  azs                 = var.azs
  public_subnet_cidrs = var.public_subnet_cidrs
  app_subnet_cidrs    = var.app_subnet_cidrs
  db_subnet_cidrs     = var.db_subnet_cidrs
  enable_nat_gateway  = var.enable_nat_gateway
}

module "security" {
  source = "../../modules/security"

  name              = local.name
  vpc_id            = module.network.vpc_id
  app_port          = var.app_port
  alb_ingress_cidrs = var.alb_ingress_cidrs
}

module "monitoring" {
  source = "../../modules/monitoring"

  project            = var.project
  environment        = var.environment
  log_retention_days = var.log_retention_days
}

module "database" {
  source = "../../modules/database"

  name                  = local.name
  subnet_ids            = module.network.db_subnet_ids
  security_group_id     = module.security.db_sg_id
  instance_class        = var.db_instance_class
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  log_retention_days    = var.log_retention_days
}

module "alb" {
  source = "../../modules/alb"

  name               = local.name
  vpc_id             = module.network.vpc_id
  public_subnet_ids  = module.network.public_subnet_ids
  security_group_id  = module.security.alb_sg_id
  app_port           = var.app_port
  access_logs_bucket = var.artifacts_bucket_name
}

module "compute" {
  source = "../../modules/compute"

  name   = local.name
  region = var.region

  subnet_ids              = module.network.instance_subnet_ids
  associate_public_ip     = module.network.instances_need_public_ip
  security_group_id       = module.security.app_sg_id
  target_group_arn        = module.alb.target_group_arn
  alb_arn_suffix          = module.alb.arn_suffix
  target_group_arn_suffix = module.alb.target_group_arn_suffix

  instance_type      = var.instance_type
  ecr_repository_url = data.aws_ecr_repository.app.repository_url
  ecr_repository_arn = data.aws_ecr_repository.app.arn
  image_tag          = var.image_tag
  app_port           = var.app_port
  log_group_name     = module.monitoring.app_log_group_name
  log_group_arn      = module.monitoring.app_log_group_arn

  db_host       = module.database.address
  db_port       = module.database.port
  db_name       = module.database.db_name
  db_user       = module.database.master_username
  db_secret_arn = module.database.master_user_secret_arn
  db_pool_max   = var.db_pool_max

  min_size                                = var.asg_min_size
  desired_capacity                        = var.asg_desired_capacity
  max_size                                = var.asg_max_size
  target_requests_per_instance_per_minute = var.target_requests_per_instance_per_minute
  target_cpu_percent                      = var.target_cpu_percent
}
