# 04 — Cost Estimate

> Approximate **us-east-1 on-demand** prices (USD). Mumbai (ap-south-1) is roughly 5–25% higher.
> The exact figures will be re-checked with the AWS Pricing Calculator before the first deployment.

## Hourly cost while the `dev` stack is running

| Resource | Qty | Approx. rate | Per hour |
|---|---|---|---|
| EC2 t3.micro | 2 (baseline) | $0.0104/h | $0.021 |
| EBS gp3 root, 8 GB | 2 | $0.08/GB-mo | $0.002 |
| Application Load Balancer | 1 | $0.0225/h + LCUs | ~$0.03 |
| **NAT Gateway** | 1 | $0.045/h + $0.045/GB | **$0.045** |
| Public IPv4 addresses (ALB×2, NAT×1) | 3 | $0.005/h | $0.015 |
| RDS db.t4g.micro PostgreSQL, Single-AZ, 20 GB gp3 | 1 | $0.016/h + storage | ~$0.019 |
| CloudWatch (logs, 1 dashboard, ~6 alarms, EC2 detailed monitoring) | — | mostly free-tier, pro-rated | ~$0.01 |
| **Total (baseline, 2 instances)** | | | **≈ $0.14/h** |
| Total at max scale (4 instances) | | | ≈ $0.16/h |

The NAT Gateway is the **largest single item (~1/3)**. Setting `enable_nat_gateway = false` brings the total to ≈ $0.10/h.

## Persistent costs (bootstrap stack, kept between sessions)

| Resource | Monthly |
|---|---|
| S3 state + logs + reports (< 1 GB) | < $0.05 |
| ECR (≤ 5 images × ~150 MB) | ~$0.08 |
| AWS Budget (first 2 free) | $0 |
| **Total** | **< $0.15/month** |

## Project budget

| Scenario | Hours | Cost |
|---|---|---|
| Phase 4–6 work sessions, destroyed after each | ~30 h | **≈ $4–5** |
| ⚠️ Accidentally left running for a month | 730 h | **≈ $100** |

## Guardrails
1. Run `terraform destroy` in `infra/envs/dev` at the end of **every** session. The README will include a one-line cleanup command.
2. An AWS Budget with an email alert at $5 (forecast) and $10 (actual) is created in bootstrap.
3. All resources are tagged `Project=cc-checkout`, `Env=dev`, so Cost Explorer can filter them.
4. RDS uses `skip_final_snapshot = true` and `deletion_protection = false` in dev **only**, so destroy is clean. Snapshots would cost money after the project ends.
5. Free-tier note: AWS accounts created after 15 July 2025 receive credits (up to $200) instead of the old 12-month free tier. Either way this project should fit within them.
