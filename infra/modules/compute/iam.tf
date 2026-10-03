# Least-privilege instance role. The instances can only:
#   * pull images from the ONE application ECR repository
#   * read the ONE database secret
#   * write to the ONE application log group
#   * register with SSM Session Manager (shell access without SSH/port 22)

resource "aws_iam_role" "instance" {
  name        = "${var.name}-instance-role"
  description = "EC2 instances of the ${var.name} Auto Scaling Group"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "app" {
  name = "${var.name}-app-access"
  role = aws_iam_role.instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuthToken"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken" # account-level API, cannot be scoped
        Resource = "*"
      },
      {
        Sid    = "EcrPullAppImage"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = var.ecr_repository_arn
      },
      {
        Sid      = "ReadDatabaseSecret"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = var.db_secret_arn
      },
      {
        Sid      = "WriteAppLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${var.log_group_arn}:*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "instance" {
  name = "${var.name}-instance-profile"
  role = aws_iam_role.instance.name
}
