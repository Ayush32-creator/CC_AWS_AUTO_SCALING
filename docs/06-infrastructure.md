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
| bootstrap | 2 × S3 bucket (+ versioning, SSE-S3, public-access block, ownership, TLS-only policy, lifecycle), ECR repo + lifecycle policy, Budget | ECR tags are **immutable** and scanned on push. The last 5 **tagged** releases are kept, and unreferenced untagged images are removed after 1 day (see §7). The ALB log delivery principal is allowed into `alb-logs/`. Budget alerts at 50% forecast and 100% actual. |
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
| Real `terraform plan` against AWS | Phase 4, 2026-10-04: **bootstrap** planned against `cc-project`, 16 to add, 0 to change, 0 to destroy. **dev** can only be planned after bootstrap exists (S3 state backend + ECR data source). |

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
| AWS-0077 | RDS backup retention 1 day | The AWS Free plan rejects longer retention (`FreeTierRestrictionError`). `db_backup_retention_days` can be raised after upgrading to the paid plan. |
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

1. **AWS project** (new AWS sign-up experience), project `cc-project`, Region **ap-southeast-2**. There is no IAM user and there are no access keys. The CLI uses short-lived credentials from the browser-based `aws login`:
   ```powershell
   aws configure set region ap-southeast-2 --profile cc-project
   aws login --region ap-southeast-2 --profile cc-project   # opens the browser; pick the project
   aws sts get-caller-identity --profile cc-project
   $env:AWS_PROFILE = "cc-project"                           # Terraform and the commands below use this profile
   ```
   When the session expires, run `aws login` again. Credentials are cached in `%USERPROFILE%\.aws`, never in the repo.
2. **EC2 vCPU quota.** Four `t3.micro` instances need **8 vCPUs** of "Running On-Demand Standard instances". New accounts sometimes start lower. Check it:
   ```powershell
   aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A --region ap-southeast-2 --query Quota.Value
   ```
   If the value is below 8, request an increase in the Service Quotas console (free, but it can take hours). Alternatively, set `asg_max_size` to fit the quota.
   *Checked 2026-10-04: the project's quota is **5 vCPUs**, which fits only 2 × `t3.micro`. Decision: no quota request for now. `asg_max_size` defaults to **2**, so the group scales between 1 and 2 instances. The rolling instance refresh (min 50% healthy) replaces instances one at a time and never runs more than 2. To go back to 4, request 8 vCPUs and set `asg_max_size = 4`.*
3. **Budget email.** After the bootstrap apply, confirm the subscription email AWS sends.
4. **Docker Desktop running**, so the image can be built and pushed.

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
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin $REPO.Split('/')[0]
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
| ~~**Orders stuck in `PENDING`.**~~ | **Done in Phase 5 increment 2:** an in-process reaper on every instance expires `PENDING` orders older than 10 min (`EXPIRED` + reason) and releases their stock. Row locks (`FOR UPDATE SKIP LOCKED`) are used instead of a single advisory-lock leader. See docs/02 "Stale PENDING orders". |
| The app connects as the RDS **master** user. | Phase 5 (optional): a least-privilege `app_user` created by migration. |
| HTTP only, with no TLS on the ALB. | Needs a domain + ACM certificate. Documented as a production improvement. |
| No NAT Gateway by default (§7) | Instances have public IPs; `app-sg` admits only the ALB. With `enable_nat_gateway = true` there is a single NAT (~$0.059/h): if AZ-a fails, instances in AZ-b lose egress, but serving traffic is unaffected. Production would use private subnets with one NAT per AZ, or VPC interface endpoints. |
| No VPC Flow Logs, WAF or GuardDuty | Extra cost. Mentioned in the security section of the report. |
| Bootstrap state is a local file | Back up `infra/bootstrap/terraform.tfstate`. It is small and can be recreated with `terraform import` if lost. |
| GitHub OIDC role for CI/CD | **Not possible in this AWS project**: its managed SCP denies `iam:*Provider*`. CI runs without AWS access, and CD is `scripts/deploy.sh` (docs/09). |

## 7. Phase 4 changes: AWS project and Region

The AWS account is a **project** in the new AWS sign-up experience (`cc-project`, account 498245873403, Free plan with $100 credits). Its managed service and resource control policies drove these changes.

### Region: ap-south-1 → ap-southeast-2
A project can create Regional resources only in its assigned Region, which is **ap-southeast-2 (Sydney)**. Changed:

| File | Change |
|---|---|
| `bootstrap/variables.tf`, `bootstrap/terraform.tfvars.example` | `region` default → `ap-southeast-2` |
| `envs/dev/variables.tf` | `region` → `ap-southeast-2`; `azs` → `ap-southeast-2a`, `ap-southeast-2b` |
| `envs/dev/versions.tf` | S3 backend `region` → `ap-southeast-2` (the state bucket is created by bootstrap in the same Region) |
| `modules/database/main.tf` | Comment only: the backup window 19:00 UTC is 05:00 AEST |
| `envs/dev/tests`, `modules/network/tests`, `modules/compute/tests` | Mock ARNs, AZs and endpoint names use the new Region |
| Docs 01, 04, 05, 06, README | Region and costs |

The modules had no hard-coded Region. The S3 endpoint name, ECR registry and log driver Region all come from `var.region`.

### NAT Gateway: off by default
The instances only make **outbound HTTPS** calls (ECR, Secrets Manager, CloudWatch Logs, SSM, Amazon Linux repositories) and PostgreSQL to RDS inside the VPC. Options:

| Option | Extra cost/h (Sydney) | Notes |
|---|---|---|
| **Public subnets + public IP per instance (chosen)** | $0.005 per instance | `app-sg` accepts only port 3000 from `alb-sg`, so the instances are unreachable from the internet. No SSH; shell access is through SSM. |
| Private subnets + NAT Gateway | $0.059 + $0.059/GB + 1 EIP | The original design. Still available with `enable_nat_gateway = true`. |
| Private subnets + interface endpoints (ecr.api, ecr.dkr, secretsmanager, logs, ssm, ssmmessages, ec2messages) | ~7 × 2 AZ × ~$0.011 ≈ $0.15 | Most private, but more expensive than NAT at this scale. |

Image layers and Amazon Linux 2023 packages are served from S3, so they use the free S3 gateway endpoint in both modes. RDS stays in DB subnets with no internet route either way.

### ALB access-log bucket policy
The project's resource control policy denies S3 access from principals outside the organization unless they are AWS service principals. The legacy policy, which granted access to the regional ELB **account** (`783225319266` in Sydney), would be denied, and enabling ALB access logs would fail. The bucket policy now grants `logdelivery.elasticloadbalancing.amazonaws.com`, which AWS recommends for all Regions. It is restricted with `aws:SourceArn` to load balancers in this account and Region.

### Service availability (Free plan, checked 2026-10-04)
Every service used is on the Free plan list of the [new AWS sign-up supported services](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html): VPC, EC2 (including Auto Scaling and EBS), Elastic Load Balancing, ECR, RDS, S3, CloudWatch and CloudWatch Logs, Secrets Manager, IAM, STS, KMS, Systems Manager, and AWS Budgets. The Free plan policy blocks Spot instances, dedicated hosts, Reserved Instance purchases, Transit Gateway and VPN; none of them are used. If a spend limit is reached, a separate policy blocks `RunInstances`, `CreateLoadBalancer`, `CreateAutoScalingGroup`, `CreateNatGateway` and `CreateDBInstance`. That policy is the first thing to check if creation suddenly fails with AccessDenied.

### Bootstrap applied (2026-10-04)
`terraform apply` of the reviewed plan: **17 added, 0 changed, 0 destroyed** (16 S3/ECR resources + the budget). A follow-up `terraform plan` shows no changes.

| Output | Value |
|---|---|
| `state_bucket` | `cc-checkout-tfstate-498245873403` |
| `artifacts_bucket` | `cc-checkout-artifacts-498245873403` |
| `ecr_repository_url` | `498245873403.dkr.ecr.ap-southeast-2.amazonaws.com/cc-checkout` |
| Budget | `cc-checkout-monthly`, $10/month; email at 50% forecast and 100% actual |

Verified with the AWS CLI: both buckets are in ap-southeast-2, versioned, SSE-S3, all four public-access blocks on, TLS-only policy; ALB log delivery uses the service principal. ECR tags are immutable and scanned on push; lifecycle rule as originally written (revised below). No EC2, RDS, ALB, ASG or NAT resources exist.

### ECR lifecycle policy fix
Docker Desktop pushes each build as an **OCI image index** tagged with the git SHA. The index references two untagged children: the `linux/amd64` image manifest and a build attestation. The original rule (`tagStatus = any`, keep 5) counted all three as separate images, so it kept only about 1–2 complete releases. The revised policy:

1. **Tagged images (`tagPatternList ["*"]`): keep the last 5.** Each release has exactly one tag (its git SHA), so this means 5 complete releases.
2. **Untagged: expire after 1 day.** ECR never expires an image that is still referenced by an index, so the children of retained releases are protected. Only children whose index has expired, or stray untagged pushes, are removed. Attestations that reference a deleted image are cleaned up by ECR automatically.

### Starting capacity
`asg_desired_capacity` defaults to **1** (min 1, max 2), so load tests show the Auto Scaling group scaling out from 1 to 2 instances.

### Free plan RDS limits (found during the first dev apply)
The first `terraform apply` of the dev stack created 39 of 45 resources and then failed: `CreateDBInstance` was rejected with **FreeTierRestrictionError: backup retention period exceeds the maximum available to free tier customers**. The Free plan allows **1 day**. Fixes:

- `envs/dev`: new `db_backup_retention_days` variable, default **1**, passed to the database module. The module default (7) is unchanged.
- `modules/database`: `rds.force_ssl` now declares `apply_method = "pending-reboot"`, the value AWS stores. Without it, every plan showed an in-place change to the parameter group.

Point-in-time recovery is limited to the last 24 hours. That's acceptable for a dev stack that is destroyed after each session.

### Dev stack deployed and verified (2026-10-04)
After the Free plan fix, the remaining 6 resources applied cleanly. Terraform state holds **45 resources**, and a follow-up plan shows no changes.

| Check | Result |
|---|---|
| VPC / subnets | `10.0.0.0/16`; 2 public, 2 app and 2 DB subnets in ap-southeast-2a/2b; the DB route table has only the local route; no NAT Gateway |
| Security groups | alb-sg: 80 from the internet → app-sg: 3000 from alb-sg only → db-sg: 5432 from app-sg only; the default SG has no rules |
| ALB | active, internet-facing, 2 AZs, HTTP:80 forward, access logs to `cc-checkout-artifacts-…/alb-logs`, invalid headers dropped |
| Target group | `/api/health` every 15 s; 1 target **healthy** |
| ASG | min 1 / desired 1 / max 2, ELB health checks, CPU 60% and 300 requests/target tracking policies; 1 instance InService |
| EC2 | 1 × t3.micro (AL2023), IMDSv2 required, instance profile attached |
| RDS | PostgreSQL 16.13, db.t4g.micro, **not publicly accessible**, encrypted gp3 20 GB, Single-AZ, backups 1 day, `rds.force_ssl = 1` |
| Secrets Manager | RDS-managed master secret, active, rotation every 7 days |
| CloudWatch Logs | `/cc-checkout/dev/app` (one stream per instance) and the RDS PostgreSQL log group, 7-day retention |
| SSM | instance **Online** (Session Manager available, no SSH) |
| App via ALB | `/api/health` 200; `/api/health/ready` 200 `database: ok` (TLS to RDS); `/api/instance` reports version **8bc96ee**; SPA and products load; checkout returns 201 `PAID`; same Idempotency-Key replays the same order (200, `Idempotent-Replayed: true`) and stock is reduced only once |

## 8. Phase 5, increment 1: CloudWatch observability

All observability is in `modules/monitoring`. The module now receives the ALB, target group, ASG and RDS identifiers from `envs/dev`. There are no app changes and no redeploy: the app already writes one JSON log line per checkout.

| Resource | Details |
|---|---|
| 4 log metric filters on `/cc-checkout/dev/app` → namespace `cc-checkout/dev` | `OrdersPlaced` (`outcome = paid`), `OrdersFailed` (`outcome = declined`), `CheckoutLatency` (`latencyMs` of paid + declined; replays excluded; no default value so percentiles stay honest), `AppErrors` (`level >= 50`) |
| Alarm `cc-checkout-dev-alb-5xx-rate` | (ELB 5xx + target 5xx) / requests > 5% in 3 of 5 min. Metric math ignores minutes with < 10 requests, so one error at idle does not alarm |
| Alarm `cc-checkout-dev-no-healthy-targets` | `HealthyHostCount` < 1 for 2 consecutive minutes, which is a real outage. Not `UnHealthyHostCount > 0`: scale-out instances are unhealthy while they boot |
| Alarm `cc-checkout-dev-p95-latency` | p95 `TargetResponseTime` > 1 s in 3 of 5 min |
| Alarm `cc-checkout-dev-rds-cpu` | RDS CPU average > 80% for 15 min |
| Dashboard `cc-checkout-dev` | 12 graphs (scaling, traffic, health, latency, errors, EC2/RDS, orders, checkout latency, app errors) + alarm overview |
| SNS topic + email subscription | **Only if `alarm_email` is set** (default `null`). AWS sends a confirmation link. The topic is not encrypted: CloudWatch alarms cannot publish to a topic encrypted with the AWS-managed `aws/sns` key, and a CMK costs $1/month (Trivy AWS-0095/0136 accepted) |

All alarms use `treat_missing_data = notBreaching`, so an idle stack (no traffic, see docs/07 §4) never alarms. The four target-tracking alarms stay owned by the ASG policies.

**Verification before apply:**
- `terraform test` in `modules/monitoring`: 6/6 (filters, thresholds, SNS on/off, email validation, dashboard content).
- `envs/dev` 7/7, TFLint 0 issues, Trivy 138/0.
- The filter patterns were checked with `aws logs test-metric-filter` against real checkout log lines from the dev stack: OrdersPlaced matched the 3 paid orders, the 2 replays were excluded, and AppErrors matched nothing.
- Real plan: **9 to add, 0 to change, 0 to destroy**.

**Cost:** within the CloudWatch free tier (10 custom metrics, 10 alarms, 3 dashboards per month). EC2 detailed monitoring also uses custom-metric allowance, so expect ≈ $0–0.30/month. Worst case without any free tier: ≈ $4.60/month.

### Increment 1 deployed and verified (2026-10-04)
Applied with `alarm_email` unset (no SNS): **9 added, 0 changed, 0 destroyed**. The dev state now holds 54 resources, and a follow-up plan shows **no changes**.

| Check | Result |
|---|---|
| Metric filters | 4 active on `/cc-checkout/dev/app`: OrdersPlaced, OrdersFailed, AppErrors (default 0) and CheckoutLatency (`$.latencyMs`, no default) |
| Dashboard `cc-checkout-dev` | 13 widgets: 12 graphs + alarm overview listing the 4 alarms |
| Alarms | All 4 moved INSUFFICIENT_DATA → **OK** within ~2 min of creation; none fired. Project total: 8 alarms (4 new + 4 target-tracking) |
| Test checkout | Order `59e51dec-…` 201 `PAID`. Within ~30 s: `OrdersPlaced` = 1, `OrdersFailed` = 0, `AppErrors` = 0, `CheckoutLatency` = 1 sample of **310 ms**, identical to `latencyMs: 310` in the app's log line |
| Tests / lint / security | monitoring 6/6, dev 7/7, `terraform fmt` clean, TFLint 0 issues, Trivy 138/0 |

## 9. Phase 5, increment 2: pending-order reaper (deployed 2026-10-04)

App-only change (design: docs/02 "Stale PENDING orders"). **No new AWS resources.** Deployed through the normal Terraform path: `image_tag = "a0cbc11"` in `envs/dev/terraform.tfvars` → new launch-template version → ASG rolling instance refresh.

| Step | Result |
|---|---|
| Image | `cc-checkout:a0cbc11` (digest `sha256:e673d052…`), pushed next to `8bc96ee` (kept for rollback; lifecycle keeps 5 tagged releases) |
| Local check before push | Image run against the local Postgres: migration `003_pending_order_expiry.sql` applied to a populated DB, `/api/health/ready` ok, reaper started |
| Plan | **0 add, 2 change, 0 destroy**. The decoded user-data diff was only the image tag (pull URI and `APP_VERSION`); ASG stayed 1/1/2 |
| Instance refresh | 17:54:19 → 17:58:45 UTC (**4 m 26 s**), Successful. `i-07ca510c699761eee` (`8bc96ee`) replaced by **`i-0dca1c1ad25992656`** (`a0cbc11`, ap-southeast-2a) |
| Availability during deploy | A probe every ~3 s returned **200 on every request** (~70 probes). The replacement served traffic before the old instance was removed, so there was **no downtime** |
| After deploy | Target healthy; SSM Online; `/api/health` ok; `/api/health/ready` `database: ok`; CloudWatch shows `Applied migration 003`, `Checkout API listening`, `Pending-order reaper started` (timeout 600 s, interval 60 s, batch 100) |
| Checkout via ALB | 201 `PAID` (`24ab2960-…`), `statusReason: null`; replay 200 with the same order; stock 35 → 34. The 4 earlier PAID orders are unchanged |
| Metrics | `OrdersPlaced` 1 and `CheckoutLatency` 219 ms (= the log's `latencyMs`), `AppErrors` 0 throughout the deploy. All 4 alarms OK |
| Terraform | Follow-up `plan`: **no changes**; `terraform test` (dev) 7/7 |

Tests: backend 77 (30 unit + 47 integration, of which 22 new), frontend 11. The concurrency suite passed 5 repeated runs.

## 10. Phase 5, increment 3: security and IAM hardening (deployed 2026-10-05)

Full review: **docs/08-security-review.md**. Two changes, both in `modules/compute`, no new AWS resources:

1. **IAM:** an explicit `Deny` of `ssm:GetParameter*` on Parameter Store in the instance role's inline policy. It overrides the broad read allowed by `AmazonSSMManagedInstanceCore`, which Session Manager needs but whose parameter-read part the instances do not.
2. **Container:** the app container now runs with `--read-only`, a small `noexec` `/tmp` tmpfs, `--cap-drop ALL`, `no-new-privileges` and `--pids-limit 256`. The image already ran as the non-root `node` user.

Plan **0 add / 3 change / 0 destroy**, rolled out by instance refresh in 4 m 26 s with **77/77 probes 200** (no downtime); new instance `i-0f728c5cdb3aa7aa2`, same image `a0cbc11`. Both changes were verified on the live instance through SSM Run Command (read-only). The follow-up plan shows no changes.

