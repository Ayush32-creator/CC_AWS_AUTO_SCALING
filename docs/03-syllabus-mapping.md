# 03 — Syllabus-to-Feature Mapping

| Unit | Concept | Where it appears in the project | Evidence for the report |
|---|---|---|---|
| **I — Intro to CC** | Cloud vs traditional architecture | Report section comparing a single on-prem server with a fixed capacity to an elastic ASG behind an ALB | Comparison table and diagram |
| | Distributed computing | Stateless app replicas across 2 AZs sharing one DB; load-balanced requests | `/api/instance` badge showing different instances |
| | Elasticity vs scalability | Target-tracking ASG (elasticity); horizontal scale-out design (scalability) | Instance-count vs load graph from k6 run |
| | IaaS, public cloud | EC2, VPC and RDS on AWS public cloud | — |
| **II — Virtualization** | Virtual machines | EC2 instances (Nitro hypervisor), launch template defines vCPU/RAM | Launch template in Terraform |
| | Containers vs VMs | Docker container *inside* each VM; image size and start-time comparison | Measured table: VM boot time vs container start time |
| | Resource allocation, elasticity | Instance type sizing, container memory limits, ASG min/desired/max | ASG activity history screenshot |
| **III — Cloud Services** | Service models (IaaS/PaaS/SaaS) | EC2 = IaaS; RDS = managed (PaaS-like) DB; discussion of ECS/Beanstalk as PaaS alternatives | Report section |
| | Application deployment | Docker image → ECR → EC2 via user-data; rolling instance refresh | CD workflow run |
| | Cloud management | Terraform lifecycle (plan/apply/destroy), AWS console/CLI | `terraform plan` output |
| **IV — Cloud Storage** | Object storage (S3) | Terraform remote state (versioned), ALB access logs, archived load-test reports | Bucket listing, log sample |
| | Relational storage (RDS) | Products, orders, order items; ACID transactions; automated backups | Schema, backup config |
| | Block storage (EBS) | gp3 root volumes on EC2, RDS gp3 storage | — |
| | Persistence & consistency | Orders survive instance termination; unique-constraint idempotency | Failure test: kill instance mid-load, count orders |
| | NoSQL | **Deliberately excluded.** Explained in report (relational, transactional data) | Design justification |
| **V — Service Management** | Monitoring | CloudWatch dashboard, alarms, custom metrics from log metric filters (OrdersPlaced, OrdersFailed, CheckoutLatency, AppErrors) | Dashboard screenshots |
| | Logging | Centralized JSON logs in CloudWatch Logs; Logs Insights queries | Query examples |
| | Availability & SLA | Multi-AZ app tier, health checks, composite SLA calculation, SLOs | SLA section + test results |
| | Cost management | Cost estimate, AWS Budget alert, destroy-after-session workflow, NAT toggle | `04-cost-estimate.md` |
| | IAM & security | Least-privilege instance role (+ explicit Parameter Store deny), hardened container (read-only, no capabilities), Secrets Manager, no SSH, CI without any cloud credentials | docs/08-security-review.md, IAM policy JSON |
| | DevOps | GitHub Actions CI (tests, Terraform checks, lint, secret/IaC/image scans, hardened smoke run) + guarded one-command CD with rollback, IaC | Workflow runs, docs/09-ci-cd.md |
| **VI — Networking & Security** | VPC & subnets | 3-tier subnet design across 2 AZs | Network diagram |
| | Public/private IPs, routing | Public subnets via IGW; private via NAT; DB tier with no internet route | Route table screenshots |
| | Security groups | Chained ALB → App → DB SGs | SG rules table |
| | Load balancing | ALB with health checks, deregistration delay, cross-zone | Target group health screenshot |
| | Secure communication | TLS to RDS enforced, encryption at rest (RDS, EBS, S3), IMDSv2 required | Config excerpts |

## Excluded on purpose (and why)

| Topic | Reason |
|---|---|
| GCP services (App Engine, Cloud Functions, BigQuery) | Excluded by the brief. |
| Lambda / serverless | It would replace the EC2 + ASG scaling the brief asks to demonstrate. Mentioned only as a contrast. |
| DynamoDB / ElastiCache | No genuine need. The cart is client-side and the data is relational. |
| ECS / EKS | They hide the VM/container distinction the course emphasises, and EKS costs $0.10/h for the control plane. |
| CloudFront, WAF, Route 53, ACM | Need a domain or add cost without improving the core demo. Optional if you own a domain. |
| Multi-AZ RDS | Doubles DB cost. Analysed in the SLA section instead of deployed. |
