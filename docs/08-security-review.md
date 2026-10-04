# 08 — Security Review and Hardening (Phase 5, increment 3)

> Reviewed and applied on **2026-10-05** against the running dev stack (AWS project `cc-project`, ap-southeast-2).
> Scope: IAM, network, EC2, RDS, secrets, ECR/container, Terraform/repository. No new AWS services were added, and the application's behaviour is unchanged.

## Summary

| Area | Status before | Change made | Verified on AWS |
|---|---|---|---|
| IAM instance role | Inline policy already least-privilege; AWS-managed SSM policy also allowed `ssm:GetParameter(s)` on **all** parameters | **Explicit Deny** of Parameter Store reads | `get-parameter` from the instance → `AccessDenied … explicit deny` |
| Container runtime | Non-root (`node`), but default Docker capabilities and a writable filesystem | **Read-only root FS, all capabilities dropped, no-new-privileges, PID limit** | `docker inspect` + `/proc/1/status` on the instance |
| Network | Correct chained security groups | none needed | rules listed below |
| EC2 | IMDSv2, encrypted EBS, no key pair, SSM | none needed | instance attributes |
| RDS | Private, encrypted, TLS forced | none needed | instance attributes |
| Secrets | Secrets Manager, fetched at runtime by the role | none needed | scans below |
| ECR | Immutable tags, scan on push, lifecycle | none needed | scan results below |

## 1. IAM least privilege

Instance role `cc-checkout-dev-instance-role`, inline policy `cc-checkout-dev-app-access`:

| Sid | Effect | Actions | Resource |
|---|---|---|---|
| EcrAuthToken | Allow | `ecr:GetAuthorizationToken` | `*`. This account-level API cannot be scoped; it is the only `*` resource |
| EcrPullAppImage | Allow | `ecr:BatchCheckLayerAvailability`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` | the `cc-checkout` repository only |
| ReadDatabaseSecret | Allow | `secretsmanager:GetSecretValue` | the one RDS-managed secret |
| WriteAppLogs | Allow | `logs:CreateLogStream`, `logs:PutLogEvents` | `/cc-checkout/dev/app` log group only |
| **DenyParameterStoreReads** *(new)* | **Deny** | `ssm:GetParameter`, `GetParameters`, `GetParametersByPath`, `GetParameterHistory` | `arn:aws:ssm:*:*:parameter/*` |

Plus the AWS-managed `AmazonSSMManagedInstanceCore` (Session Manager). That policy includes `ssm:GetParameter`/`GetParameters` on `*`. The instance never reads parameters (Terraform resolves the AMI; the DB password comes from Secrets Manager). The explicit Deny overrides the managed Allow, so a compromised container cannot read any Parameter Store value. A custom Session Manager policy was considered instead of the managed one. It was rejected because it carries more risk of breaking SSM, while the Deny achieves the same reduction.

- No wildcard actions (enforced by `terraform test`). No AdministratorAccess. No IAM users or access keys exist; humans use the AWS project's browser login.
- Trust policy: only `ec2.amazonaws.com` may assume the role.

## 2. Network

| Rule | Source / destination |
|---|---|
| ALB SG in | TCP 80 from `0.0.0.0/0` (public site; can be narrowed with `alb_ingress_cidrs`) |
| ALB SG out | TCP 3000 → app SG only |
| App SG in | TCP 3000 **from the ALB SG only**. No SSH (22) or any other port |
| App SG out | TCP 443 → `0.0.0.0/0` (AWS APIs, OS packages; no NAT/endpoints); TCP 5432 → DB SG only |
| DB SG in | TCP 5432 **from the app SG only** |
| DB SG out | none |
| VPC default SG | no rules (locked down by Terraform) |

DB subnets have no route to the internet. Instances have public IPs (no NAT, docs/06 §7) but accept traffic only from the ALB. No NAT Gateway was added.

## 3. EC2

| Check | Result |
|---|---|
| IMDSv2 | `http_tokens = required`, hop limit 2 (lets the container use the instance role) |
| Root volume | gp3, **encrypted** |
| Credentials | IAM instance profile only. `/root/.aws` contains only the AWS CLI session cache (`cli/cache/session.db`): **no credentials/config file, 0 files containing access keys** |
| Remote access | SSM Session Manager (instance Online); **no key pair, no port 22** |
| Container user | `node` (uid 1000), set in the Dockerfile |
| **Container runtime (new)** | `--read-only`, `--tmpfs /tmp:rw,noexec,nosuid,size=16m`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 256`. Verified on the instance: `ReadonlyRootfs=true`, `CapDrop=[ALL]`, `CapEff 0000000000000000`, `NoNewPrivs 1`, `Privileged=false`; writes to `/app` fail with "Read-only file system" |

The flags were first tested locally with the same image. The app starts, serves the SPA and API, Docker's HEALTHCHECK is healthy, and the RDS CA bundle is readable.

## 4. RDS

| Check | Result |
|---|---|
| Public access | `PubliclyAccessible = false`; DB subnets only |
| Encryption at rest | `StorageEncrypted = true` |
| TLS | `rds.force_ssl = 1`; the app connects with `DB_SSL=true` and verifies the server certificate against the RDS CA bundle (`rds-ca-rsa2048-g1`) |
| Network | DB SG admits 5432 from the app SG only |
| Backups | 1 day (AWS Free plan maximum; unchanged) |
| Accepted | No IAM DB auth (an RDS-managed, rotated Secrets Manager password is used instead); deletion protection off in dev |

## 5. Secrets

| Check | Result |
|---|---|
| DB password storage | RDS-managed secret in Secrets Manager (`manage_master_user_password`), rotation enabled (7 days) |
| How the app gets it | `GetSecretValue` with the instance role at runtime (cached 60 s, re-read after rotation). Never in env vars, user-data, image or Terraform |
| Terraform state | Scanned: no key holds a password/secret/token value. Only `manage_master_user_password = true` and `http_tokens = required` matched by name |
| Terraform outputs | No secrets. `db_secret_arn` is an identifier, not the value |
| Repository (all 119 tracked files) | **Trivy secret scan: 0 findings** |
| Git history | No secret values in any commit. Matches are only code handling secrets and the documented `ecr get-login-password` command |
| Local `.env`, `*.tfvars`, `backend.hcl`, `*.tfstate` | git-ignored; none tracked |
| Logs | pino redacts `payment.cardNumber`/`payment.cvc`; only `card_last4` is stored |

## 6. ECR and image

| Check | Result |
|---|---|
| Tags | `IMMUTABLE`; deployments use git SHAs (`8bc96ee` kept for rollback, `a0cbc11` running) |
| Scanning | Basic scan on push. `a0cbc11` and `8bc96ee`: **0 findings** (OS packages) |
| Node dependencies | `npm audit --omit=dev`: backend **0**, frontend **0** vulnerabilities |
| Lifecycle | Keep 5 tagged releases; expire unreferenced untagged images after 1 day |
| Encryption | AES256 |
| Image content | No AWS credentials or secrets; the only ENV values are `NODE_ENV`, `PORT`, `PUBLIC_DIR` and the Node base image's own; runs as `node` |

## 7. Terraform and tooling

- `terraform test`: compute **6/6** (new: `container_runs_hardened`, and the IAM test now also checks the Deny and that no statement uses wildcard actions); dev 7/7; monitoring 6/6; network 5/5; security 3/3.
- TFLint 0 issues; Trivy config **138 passed / 0 failed** (accepted risks are annotated inline and listed in docs/06 §3).

## Deployment record

| Step | Result |
|---|---|
| Plan | **0 add, 3 change, 0 destroy**: IAM inline policy (+1 Deny statement, nothing else), launch template (`user_data`: 5 hardening flags only, same image `a0cbc11`), ASG (launch-template version only; 1/1/2 unchanged) |
| Instance refresh | 19:30:48 → 19:35:14 UTC (4 m 26 s), Successful. `i-0dca1c1ad25992656` → **`i-0f728c5cdb3aa7aa2`** (ap-southeast-2b) |
| Availability | **77/77 probes returned 200**, zero downtime |
| After deploy | target healthy; `/api/health` ok; `/api/health/ready` `database: ok`; image `a0cbc11`; checkout 201 PAID + idempotent replay; logs in CloudWatch; 4 alarms OK; SSM Online |
| Terraform | follow-up plan **no changes**; 54 resources; no new AWS resources |

## Remaining risks (accepted for the dev environment)

| Risk | Production fix |
|---|---|
| HTTP only on the ALB | ACM certificate + HTTPS listener (needs a domain) |
| App egress 443 to `0.0.0.0/0` | VPC interface endpoints (~$0.15/h for 7 endpoints) or NAT + egress filtering |
| IMDS hop limit 2 lets the container obtain role credentials | Required by the app design; the role is tightly scoped and now denies Parameter Store |
| Single instance / single-AZ RDS | `asg_min_size = 2`, Multi-AZ RDS (cost) |
| No WAF, GuardDuty, VPC Flow Logs | GuardDuty is unsupported on this plan; WAF and Flow Logs are optional cost add-ons |
