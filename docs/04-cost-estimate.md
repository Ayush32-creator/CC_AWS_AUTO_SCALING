# 04 — Cost Estimate (ap-southeast-2, Sydney)

> Approximate **on-demand** prices for ap-southeast-2 (USD), read from the AWS Price List API on 2026-10-04 (data transfer from published pricing). Re-check them in the [AWS Pricing Calculator](https://calculator.aws/) if the deployment is delayed. Updated in Phase 4: the AWS project is assigned to Sydney, so the earlier Mumbai (ap-south-1) figures no longer apply.

## Hourly cost while `infra/envs/dev` is deployed

Default configuration: `enable_nat_gateway = false` (see docs/06 §6).

| Resource | Qty | Rate (Sydney) | Per hour |
|---|---|---|---|
| EC2 t3.micro | 1 (baseline) – 2 (max) | $0.0132/h | $0.013 – $0.026 |
| EBS gp3 root, 8 GB, encrypted | 1 – 2 | $0.096/GB-month | $0.001 – $0.002 |
| Application Load Balancer | 1 | $0.0252/h + $0.008/LCU-h (~1 LCU) | ~$0.033 |
| Public IPv4 addresses (ALB ×2, instances ×1–2) | 3 – 4 | $0.005/h | $0.015 – $0.020 |
| RDS db.t4g.micro PostgreSQL, Single-AZ | 1 | $0.025/h | $0.025 |
| RDS gp3 storage 20 GB (+ backups ≤ 20 GB, free) | 20 GB | $0.138/GB-month | $0.004 |
| Secrets Manager (RDS-managed secret) | 1 | $0.40/month + $0.05/10k calls | < $0.001 |
| CloudWatch (detailed monitoring, ASG group metrics, logs at $0.67/GB) | — | $0.30/metric-month, pro-rated | ~$0.01 |
| CloudWatch Phase 5: 4 log-derived metrics, 4 alarms, 1 dashboard | — | Free tier: 10 metrics, 10 alarms, 3 dashboards; otherwise $0.30/metric, $0.10/alarm, $3/dashboard per month | ≈ $0 (worst case ≈ $4.60/month) |
| S3 gateway endpoint | 1 | free | $0 |
| **Total, baseline (1 instance, `asg_desired_capacity = 1`)** | | | **≈ $0.10/h** |
| Total at max scale (2 instances; `asg_max_size = 2` because of the 5-vCPU quota) | | | ≈ $0.12/h |
| Total at 4 instances (only after a quota increase) | | | ≈ $0.17/h |
| Total with `enable_nat_gateway = true` (2 instances) | +NAT $0.059/h, +1 EIP, −2 instance IPs | | ≈ $0.18/h (+ $0.059/GB through NAT) |

Compared with the Mumbai estimate (≈ $0.16/h with NAT), Sydney prices are about 10–20% higher per item. Leaving out the NAT Gateway more than makes up the difference.

## Persistent costs (`infra/bootstrap`, kept between sessions)

| Resource | Monthly |
|---|---|
| S3 state + artifacts (< 1 GB, versioned, $0.025/GB-month) | < $0.03 |
| ECR (≤ 5 images × ~85 MB compressed, $0.10/GB-month) | ~$0.05 |
| AWS Budget (first 2 per account are free) | $0 |
| **Total** | **< $0.10/month** |

## Data transfer
- Internet egress from Sydney is about $0.114/GB after the first 100 GB/month, which is free across the account. Load-test responses are small JSON/HTML, so this should stay within the free 100 GB.
- Traffic between the ALB, the instances and RDS in different AZs costs $0.01/GB each way. A few GB in load tests comes to cents.
- Image pulls from ECR go through the free S3 gateway endpoint.

## Project budget: $100 credits, Free plan

The AWS project is on the **Free plan** with **$100 credits**, expiring **2027-04-04** (checked 2026-10-04 with `aws freetier get-account-plan-state`). The credits are a hard ceiling for this project, not a target to spend. *(On 2026-10-05 the remaining credits showed **$160**: the Free plan added credits during the project.)*

| Scenario | Hours deployed | Cost | Share of credits |
|---|---|---|---|
| Phase 4–6 sessions, destroyed after each (mostly 1 instance, 2 during load tests) | ~30 h | **≈ $3–4** | ~3–4% |
| Same, with NAT enabled | ~30 h | ≈ $5.50 | ~6% |
| ⚠️ Forgotten and left running for a month (no NAT) | 730 h | **≈ $73 (1 instance) – $88 (2)** | ~75–90% |
| ⚠️ Forgotten for a month with NAT | 730 h | ≈ $130 | more than all credits |

## Guardrails
1. Run `terraform destroy` in `infra/envs/dev` at the end of **every** session.
2. The bootstrap stack creates an AWS Budget (supported on the Free plan) that emails at 50% forecast and 100% actual of $10/month. Set `budget_alert_emails` in `terraform.tfvars`.
3. Check the remaining credits after each session in **AWS Settings → Billing**, or run `aws freetier get-account-plan-state --profile cc-project`. Spend limits in AWS Settings belong to the paid plan; on the Free plan, the credits and the budget alert are the controls.
4. Every resource is tagged `Project=cc-checkout` and `Environment=dev` (plus `ManagedBy=terraform`), so Cost Explorer can filter project spend.
5. `asg_max_size` is capped at 6 by validation, and `db_pool_max × asg_max_size ≤ 60`.
6. Dev RDS uses `skip_final_snapshot = true` and `deletion_protection = false`, so destroy is clean and leaves no paid snapshots.
