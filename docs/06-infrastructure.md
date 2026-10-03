# 06 — Infrastructure as Code (Terraform)

> Phase 3 deliverable. Nothing in this document has been applied yet. Deployment is Phase 4 and needs explicit approval.

## 1. Layout: two stacks

```
infra/
├── bootstrap/            apply ONCE, keep until the project ends (< $0.15/month)
│   └── S3 state bucket · S3 artifacts bucket · ECR repository · AWS Budget
├── envs/dev/             apply per work session, DESTROY afterwards (~$0.16/h)
│   ├── main.tf           wires the modules together
│   ├── tests/            terraform test (mock provider: no AWS calls)
│   └── *.example         tfvars / backend config templates
└── modules/
    ├── network/          VPC, 6 subnets in 2 AZs, IGW, NAT (optional), route tables, S3 gateway endpoint
    ├── security/         alb-sg → app-sg → db-sg (chained by SG reference)
    ├── database/         RDS PostgreSQL 16, parameter group (force SSL), RDS-managed secret
    ├── alb/              ALB, target group with health check, HTTP listener
    ├── compute/          IAM role + instance profile, launch template, user-data, ASG, 2 scaling policies
    └── monitoring/       CloudWatch log group (dashboards/alarms are added in Phase 5)
```

Why two stacks:
- **Cost.** `terraform destroy` in `envs/dev` removes everything billed by the hour. The image repository and state survive between sessions.
- **Bootstrapping.** The S3 bucket that stores remote state has to exist before any stack can use it. Bootstrap keeps its own small state locally.

## 2. Resources by module

| Module | Resources | Key settings |
|---|---|---|
| bootstrap | 2 × S3 bucket (+ versioning, SSE-S3, public-access block, ownership, TLS-only policy, lifecycle), ECR repo + lifecycle policy, Budget | ECR tags are **immutable** and scanned on push. Only the last 5 images are kept. The ALB log delivery principal is allowed into `alb-logs/`. Budget alerts at 50% forecast and 100% actual. |
| network | VPC, IGW, 2 public + 2 app + 2 DB subnets, 3 route tables, NAT GW + EIP (optional), S3 gateway endpoint, default-SG lockdown | DB route table has **no** internet route. The S3 endpoint is free and keeps ECR layer downloads off the NAT. |
| security | 3 SGs, 6 rules | ALB: 80 from `alb_ingress_cidrs`. App: 3000 from ALB SG only; egress 443 and 5432 → DB SG. DB: 5432 from app SG only. |
| database | DB subnet group, parameter group, `aws_db_instance`, log group | `manage_master_user_password` (Secrets Manager), `rds.force_ssl=1`, storage encrypted, not public, Single-AZ, 7-day backups (free up to the DB size). |
| alb | ALB, target group, listener | Health check `/api/health` every 15 s. Deregistration delay 30 s. Drops invalid headers. Access logs go to S3. |
| compute | IAM role/policy/profile, launch template, ASG, 2 target-tracking policies | AL2023 AMI from SSM, IMDSv2 required (hop limit 2), encrypted gp3 root, detailed monitoring, ELB health checks, rolling instance refresh (min 50% healthy), `desired_capacity` ignored after creation. |
| monitoring | Log group `/cc-checkout/dev/app` | 7-day retention. |

### How an instance boots (user-data)
1. Install Docker from the Amazon Linux repositories.
2. Read the instance ID from IMDSv2.
3. Log in to ECR using the instance role, then pull `<repo>:<image_tag>`.
4. Run the container with:
   - the `awslogs` log driver, so logs go to CloudWatch with one stream per instance;
   - DB host, name, user and **secret ARN** as environment variables;
   - TLS to RDS verified against the RDS CA bundle baked into the image.
5. The app fetches the password from Secrets Manager itself, runs migrations under an advisory lock, and starts listening.

**No password, key or token appears in Terraform code, tfvars, user-data or state.**

### Changes made for AWS (Phase 3)

| Change | Reason |
|---|---|
| App reads the DB password from Secrets Manager via `DB_SECRET_ARN` (`backend/src/db/secretPassword.js`), cached for 60 s | RDS-managed secrets **rotate automatically (7 days by default)**. node-postgres calls the password function for each new connection, so a rotation is picked up without a restart. The password is also never in `docker inspect` or environment variables. |
| Dockerfile downloads the Amazon RDS CA bundle | `DB_SSL=true` with full certificate verification. |
| S3 gateway endpoint added to the network module | Free. Reduces NAT data charges for image pulls. No change to the architecture. |
| `aws_default_security_group` with no rules | Hardening. The VPC's default SG can't be misused. |

## 3. Validation without AWS

### Phase 3 results

| Check | Result |
|---|---|
| `terraform fmt -check -recursive` | Pass |
| `terraform validate` (bootstrap, envs/dev) | Pass, both valid |
| `terraform test`, mock provider, plan-only (dev 7, network 5, security 3, compute 5) | **20/20 pass** |
| TFLint + AWS ruleset 0.40 (`infra/.tflint.hcl`) | 0 issues |
| Trivy IaC scan (139 checks) | 0 failures; accepted risks are annotated inline (table below) |
| Rendered user-data: `bash -n` + ShellCheck | 0 findings |
| Real `terraform plan` against AWS | **Not run.** No AWS credentials are configured. It is the first step of Phase 4 (read-only, free). |

### Accepted security findings (documented, not fixed)

| Trivy ID | Finding | Why it is accepted |
|---|---|---|
| AWS-0054 | ALB listener uses HTTP | HTTPS needs an ACM certificate for an owned domain. Payments are mocked. This is a production requirement. |
| AWS-0053 | ALB is internet-facing | Public store by design. It can be narrowed with `alb_ingress_cidrs`. |
| AWS-0104 | App egress 443 to 0.0.0.0/0 | AWS APIs are public endpoints. Interface endpoints would cost ~$7/month each, per AZ. |
| AWS-0132 / 0033 / 0017 | S3 / ECR / log groups use AWS-managed keys, not CMKs | A CMK costs $1/month each. ALB log delivery only supports SSE-S3. |
| AWS-0089 | No S3 server access logging | Extra bucket and cost. CloudTrail covers API activity. |
| AWS-0176 | No RDS IAM authentication | Uses an RDS-managed, auto-rotated Secrets Manager password instead. |
| AWS-0177 | RDS deletion protection off | Variable; off in dev only, so destroy is clean. |
| AWS-0133 | Performance Insights off | Not needed at this scale. |
| AWS-0178 | No VPC Flow Logs | Extra CloudWatch ingestion cost. Listed as a production add-on. |

### Commands

All of these run offline with no credentials and create nothing:

```powershell
cd infra
terraform fmt -check -recursive

cd bootstrap;              terraform init -backend=false; terraform validate
cd ..\envs\dev;            terraform init -backend=false; terraform validate; terraform test
cd ..\..\modules\compute;  terraform init;                terraform test   # same for modules\network, modules\security

# Lint and security scan (Docker, nothing installed). Run from infra\:
docker run --rm -v "${PWD}:/data" -w /data -e TFLINT_PLUGIN_DIR=/data/.tflint.d ghcr.io/terraform-linters/tflint --init
docker run --rm -v "${PWD}:/data" -w /data -e TFLINT_PLUGIN_DIR=/data/.tflint.d ghcr.io/terraform-linters/tflint --recursive --config /data/.tflint.hcl
docker run --rm -v "${PWD}:/src:ro" aquasec/trivy config --skip-dirs "**/.terraform" /src
```

Tip: the AWS provider is about 800 MB. A plugin cache (`plugin_cache_dir` in `%APPDATA%\terraform.rc`) stops it being downloaded once per directory. This is already configured on this machine.

`terraform test` uses `mock_provider "aws"`, which plans against fake AWS responses. A **real** `terraform plan` needs AWS credentials. It is read-only and free, but it is first run in Phase 4.

## 4. AWS-side prerequisites (manual, before Phase 4)

1. **AWS account** with MFA enabled on the root user. Don't use root for daily work.
2. **An admin identity for Terraform.** Preferably an IAM Identity Center (SSO) user with `AdministratorAccess`; otherwise an IAM user with access keys.
   ```powershell
   winget install -e --id Amazon.AWSCLI
   aws configure sso          # or: aws configure   (keys are stored in %USERPROFILE%\.aws, never in the repo)
   aws sts get-caller-identity
   aws configure set region ap-south-1
   ```
3. **EC2 vCPU quota.** Four `t3.micro` instances need **8 vCPUs** of "Running On-Demand Standard instances". New accounts sometimes start lower. Check it:
   ```powershell
   aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A --region ap-south-1 --query Quota.Value
   ```
   If the value is below 8, request an increase in the Service Quotas console (free, but it can take hours). Alternatively, set `asg_max_size` to fit the quota.
4. **Budget email.** After the bootstrap apply, confirm the subscription email AWS sends.
5. **Docker Desktop running**, so the image can be built and pushed.

## 5. Phase 4 runbook (preview; not executed yet)

```powershell
# 1. Bootstrap (one time)
cd infra\bootstrap
copy terraform.tfvars.example terraform.tfvars      # set budget_alert_emails
terraform init
terraform plan -out=tfplan                           # review
terraform apply tfplan

# 2. Build and push the image
$TAG  = git rev-parse --short HEAD
$REPO = terraform output -raw ecr_repository_url
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin $REPO.Split('/')[0]
docker build -f ..\..\backend\Dockerfile -t "${REPO}:${TAG}" ..\..
docker push "${REPO}:${TAG}"

# 3. Dev environment
cd ..\envs\dev
copy backend.hcl.example backend.hcl                 # bucket = <state_bucket output>
copy terraform.tfvars.example terraform.tfvars       # image_tag, artifacts_bucket_name
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan                           # review (~45 resources)
terraform apply tfplan                               # RDS takes ~5-10 min
terraform output app_url

# 4. Cleanup at the end of EVERY session
terraform destroy
```

Note on `docker build` on Windows: the image is built for `linux/amd64`, which matches `t3.micro` (x86_64).

## 6. Known limitations and backlog

| Item | Plan |
|---|---|
| **Orders stuck in `PENDING`.** If an instance dies between the stock reservation and the payment result, the order stays `PENDING` with its stock reserved. | **Phase 5:** a periodic reaper that marks `PENDING` orders older than N minutes as `PAYMENT_FAILED` and releases their stock. It runs under an advisory lock, so only one instance does it. A CloudWatch metric/alarm will count stale `PENDING` orders. |
| The app connects as the RDS **master** user. | Phase 5 (optional): a least-privilege `app_user` created by migration. |
| HTTP only, with no TLS on the ALB. | Needs a domain + ACM certificate. Documented as a production improvement. |
| Single NAT Gateway | Saves about $0.056/h. If AZ-a fails, instances in AZ-b lose egress, but serving traffic is unaffected. Production would use one NAT per AZ. |
| No VPC Flow Logs, WAF or GuardDuty | Extra cost. Mentioned in the security section of the report. |
| Bootstrap state is a local file | Back up `infra/bootstrap/terraform.tfstate`. It is small and can be recreated with `terraform import` if lost. |
| GitHub OIDC role for CI/CD | Phase 5, together with the workflows. |
