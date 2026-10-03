# 04 — Cost Estimate (ap-south-1, Mumbai)

> Approximate **on-demand** prices for ap-south-1 (USD), based on published AWS pricing. Re-check them in the [AWS Pricing Calculator](https://calculator.aws/) before the first deployment. Updated in Phase 3 for the chosen region (Phase 1 used us-east-1 figures).

## Hourly cost while `infra/envs/dev` is deployed

| Resource | Qty | Approx. rate | Per hour |
|---|---|---|---|
| EC2 t3.micro | 2 (baseline) | ~$0.0112/h | $0.022 |
| EBS gp3 root, 8 GB, encrypted | 2 | ~$0.091/GB-month | $0.002 |
| Application Load Balancer | 1 | ~$0.0239/h + LCUs | ~$0.03 |
| **NAT Gateway** | 1 | ~$0.056/h + $0.056/GB processed | **$0.056** |
| Public IPv4 addresses (ALB ×2, NAT ×1) | 3 | $0.005/h | $0.015 |
| RDS db.t4g.micro PostgreSQL, Single-AZ | 1 | ~$0.02/h | ~$0.02 |
| RDS gp3 storage 20 GB (+ backups ≤ 20 GB, free) | 20 GB | ~$0.13/GB-month | $0.004 |
| Secrets Manager (RDS-managed secret) | 1 | $0.40/month | < $0.001 |
| CloudWatch (detailed monitoring, logs, group metrics) | — | pro-rated | ~$0.01 |
| S3 gateway endpoint | 1 | free | $0 |
| **Total, baseline (2 instances)** | | | **≈ $0.16/h** |
| Total at max scale (4 instances) | | | ≈ $0.19/h |
| Total with `enable_nat_gateway = false` | | | ≈ $0.11/h |

The NAT Gateway is the largest single item, about a third of the total. The S3 gateway endpoint keeps ECR image-layer downloads off the NAT, so NAT data charges stay negligible.

## Persistent costs (`infra/bootstrap`, kept between sessions)

| Resource | Monthly |
|---|---|
| S3 state + artifacts (< 1 GB, versioned) | < $0.05 |
| ECR (≤ 5 images × ~85 MB compressed) | ~$0.05 |
| AWS Budget (first 2 per account are free) | $0 |
| **Total** | **< $0.15/month** |

## Project budget

| Scenario | Hours deployed | Cost |
|---|---|---|
| Phase 4–6 sessions, destroyed after each | ~30 h | **≈ $5** |
| ⚠️ Forgotten and left running for a month | 730 h | **≈ $115–140** |

Data transfer for load tests is small. ALB and NAT data charges stay well under $1 for this project.

## Guardrails
1. Run `terraform destroy` in `infra/envs/dev` at the end of **every** session.
2. The bootstrap stack creates an AWS Budget that emails at 50% forecast and 100% actual of $10.
3. Every resource is tagged `Project=cc-checkout` and `Environment=dev` (plus `ManagedBy=terraform`) for Cost Explorer.
4. `asg_max_size` is capped at 6 by validation, and `db_pool_max × asg_max_size ≤ 60`.
5. Dev RDS uses `skip_final_snapshot = true` and `deletion_protection = false`, so destroy is clean and leaves no paid snapshots.
6. Free-tier note: accounts created after 15 July 2025 get credits (up to $200) instead of the old 12-month free tier. `t3.micro` and `db.t4g.micro` are free-tier eligible on older accounts.
