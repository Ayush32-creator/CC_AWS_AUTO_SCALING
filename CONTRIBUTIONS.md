# Team Contributions

**Project:** Auto-Scaling E-Commerce Checkout System on AWS (Terraform)
**Team:** Ayush (team lead), Pankaj, Varad, Sampada · four members, **equal contribution (25 % each)**

The work was split into four ownership areas of comparable size. Each member owned the design, implementation, testing and documentation of their area, and all members took part in the shared activities listed at the end.

> Note for reviewers: commits in this repository were pushed from the team lead's GitHub account, so `git log` shows one author. This document records **which member owned each area of work**.

## Summary

| Member | Ownership area | Core deliverables |
|---|---|---|
| **Ayush** (lead) | Cloud architecture & core infrastructure (IaC) | Architecture, AWS project setup, Terraform bootstrap + dev stack, VPC/subnets, security groups, RDS, ALB, cost model, deployment to AWS |
| **Pankaj** | Backend application & data | Express API, idempotent duplicate-safe checkout, PostgreSQL schema & migrations, Secrets Manager integration, pending-order recovery, backend tests |
| **Varad** | Frontend, containerisation & CI/CD | React SPA, Docker image & local stack, GitHub Actions CI, guarded deployment & rollback script |
| **Sampada** | Auto Scaling, monitoring, security & performance testing | EC2 launch template + Auto Scaling Group + scaling policies, CloudWatch dashboard/alarms/metrics, IAM & container hardening, load testing & results |

---

## Ayush: Cloud Architecture & Core Infrastructure (Team Lead)

**Main work**
- Designed the overall architecture: 3-tier VPC across 2 Availability Zones, ALB → EC2 Auto Scaling → RDS, request flow and design decisions.
- Set up the AWS project (`cc-project`, Free plan, region **ap-southeast-2**) and migrated the design from ap-south-1 to the project's Region.
- Wrote the Terraform **bootstrap** stack (remote S3 state, artifacts bucket, ECR repository with immutable tags and lifecycle policy, $10 AWS Budget) and the **dev** environment composition.
- Built the **network** (VPC, public/app/DB subnets, routing, S3 gateway endpoint, optional NAT), **security groups** (ALB → app → DB chain), **database** (RDS PostgreSQL 16, encrypted, private, SSL forced, Secrets-Manager-managed password) and **ALB** modules.
- Decided to run without a NAT Gateway (≈ 30 % cost saving) and fitted RDS to the Free plan limits (1-day backups).
- Produced the cost model and syllabus mapping; deployed and destroyed the stacks safely (plan reviewed before every apply).

**Files**
- `docs/01-architecture.md`, `docs/03-syllabus-mapping.md`, `docs/04-cost-estimate.md`, `docs/05-implementation-plan.md`, `docs/06-infrastructure.md`, `README.md`
- `infra/bootstrap/` (`main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, `terraform.tfvars.example`)
- `infra/envs/dev/` (`main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, `*.example`, `tests/plan.tftest.hcl`)
- `infra/modules/network/` (incl. `tests/network.tftest.hcl`)
- `infra/modules/security/` (incl. `tests/security.tftest.hcl`)
- `infra/modules/database/`
- `infra/modules/alb/`

**Outcome:** 54-resource dev stack + 17-resource bootstrap stack, `terraform plan` = 0 changes after every deployment; Terraform tests dev 7/7, network 5/5, security 3/3.

---

## Pankaj: Backend Application & Data Layer

**Main work**
- Built the Node.js/Express REST API: products, cart quote, orders, health/readiness and instance endpoints, validation (zod) and central error handling.
- Implemented the **duplicate-safe checkout**: `Idempotency-Key` with a unique constraint, request hashing (409/422 on reuse), atomic stock decrement that can never oversell, server-side pricing, payment outside the DB transaction.
- Designed the PostgreSQL schema and forward-only migrations with an advisory lock (safe when several instances start together).
- Integrated **AWS Secrets Manager** for the DB password (fetched at runtime, rotation-safe cache) and TLS to RDS.
- Implemented the **pending-order recovery** (reaper): expires checkouts stuck in `PENDING` after a crash, restores stock exactly once, safe across instances (`FOR UPDATE SKIP LOCKED`).
- Wrote the backend unit and integration tests, including concurrency tests (20 parallel duplicate requests → exactly one order; no overselling).

**Files**
- `backend/src/app.js`, `server.js`, `config.js`
- `backend/src/routes/` (`orders.js`, `products.js`, `health.js`)
- `backend/src/services/` (`orderService.js`, `productService.js`, `pendingOrderReaper.js`)
- `backend/src/db/` (`pool.js`, `migrate.js`, `secretPassword.js`)
- `backend/src/lib/` (`validation.js`, `requestHash.js`, `luhn.js`, `errors.js`, `instanceMetadata.js`), `backend/src/middleware/errorHandler.js`, `backend/src/payment/mockPayment.js`
- `backend/migrations/` (`001_init.sql`, `002_seed.sql`, `003_pending_order_expiry.sql`)
- `backend/tests/unit/`, `backend/tests/integration/`
- `docs/02-api-and-data-model.md`

**Outcome:** backend tests **77/77** (30 unit + 47 integration); checkout and idempotent replay verified on AWS (201 then 200 with the same order, no double stock deduction).

---

## Varad: Frontend, Containerisation & CI/CD

**Main work**
- Built the React + Vite single-page app: product list, cart (context + reducer), checkout with automatic idempotency key and safe retries, order status page, and an "served by instance" badge that makes load balancing visible.
- Wrote the production **multi-stage Dockerfile** (non-root user, RDS CA bundle, unused package managers removed after the CI scan found CVEs in them) and the local Docker Compose stack.
- Built the **GitHub Actions CI** pipeline: backend + frontend tests, Terraform validate/test, TFLint, Trivy IaC/secret/image scans, smoke run of the hardened container, read-only token, actions pinned to commit SHAs, no cloud credentials.
- Wrote the **guarded deployment script** `scripts/deploy.sh`: builds and pushes the git-SHA image to ECR, refuses any plan that changes more than the image, waits for the rolling refresh, verifies health/readiness/checkout, and supports one-command rollback.
- Documented the CI/CD design, including why GitHub OIDC is unavailable in this AWS project.

**Files**
- `frontend/src/` (`App.jsx`, `main.jsx`, `styles.css`, `pages/*`, `cart/*`, `components/*`, `lib/*`)
- `frontend/tests/` (`app.test.jsx`, `logic.test.js`, `setup.js`), `frontend/package.json`, `frontend/vite.config.js`
- `backend/Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker/postgres/init-test-db.sql`, `.env.example`
- `.github/workflows/ci.yml`
- `scripts/deploy.sh`
- `docs/09-ci-cd.md`

**Outcome:** frontend tests **11/11**; CI green on every push to `main` and on pull requests; deployments with zero failed requests during rollout (e.g. 301/301 probes OK); rollback rehearsed (`--rollback a0cbc11`).

---

## Sampada: Auto Scaling, Monitoring, Security & Performance Testing

**Main work**
- Built the **compute module**: EC2 launch template (Amazon Linux 2023, IMDSv2, encrypted disk, user-data that pulls the image from ECR), **Auto Scaling Group 1/1/2** across two AZs, rolling instance refresh, and the **target-tracking scaling policies** (300 requests/target/min and CPU 60 %).
- Wrote the least-privilege **EC2 IAM role** (one ECR repo, one secret, one log group, SSM; explicit deny on Parameter Store) and the **container hardening** (read-only filesystem, all capabilities dropped, no-new-privileges, PID limit).
- Built **CloudWatch monitoring**: log metric filters (OrdersPlaced, OrdersFailed, CheckoutLatency, AppErrors), dashboard, and alarms (5xx rate, no healthy targets, p95 latency, RDS CPU).
- Performed the **security review** (IAM, network, EC2, RDS, secrets, image scanning).
- Planned and ran the **load and resilience tests**: scale-out 1 → 2, scale-in 2 → 1, instance-failure recovery, and the Phase 6 formal load test; analysed CloudWatch data and documented the results.

**Files**
- `infra/modules/compute/` (`main.tf`, `iam.tf`, `user-data.sh.tftpl`, `variables.tf`, `outputs.tf`, `tests/compute.tftest.hcl`)
- `infra/modules/monitoring/` (incl. `tests/monitoring.tftest.hcl`)
- `docs/08-security-review.md`
- `loadtest/` (`phase6-load.js`, `scaleout-ramp.js`, `watch-scaling.sh`, `README.md`, `results/`)
- `docs/07-phase4-test-results.md`, `docs/evidence/phase4/`, `docs/10-load-testing.md`

**Outcome:** Terraform tests compute 6/6 and monitoring 6/6; scale-out in 3 min 19 s after the alarm, scale-in 17 min after load stopped; 6,419 requests with **0 server errors**; ~1 min 44 s recovery after an instance failure (min = 1); Trivy 138/0, 0 secrets.

---

## Phase-wise ownership

| Phase | Lead | Supporting |
|---|---|---|
| 1 Planning & architecture | Ayush | All (requirements, API design, syllabus mapping) |
| 2 Application (backend + frontend) | Pankaj (backend), Varad (frontend) | Ayush (data model review) |
| 3 Docker + Terraform modules | Ayush (network, security, database, ALB, bootstrap), Sampada (compute, monitoring) | Varad (Dockerfile) |
| 4 AWS deployment & scaling tests | Ayush (deployment) | Sampada (scaling tests), Pankaj (app verification) |
| 5 Ops & security: monitoring, recovery, hardening, CI/CD | Sampada (monitoring, hardening), Pankaj (pending-order recovery), Varad (CI/CD) | Ayush (review, apply) |
| 6 Load testing & performance validation | Sampada | Ayush (stack recreation/teardown), Varad (deploy verification) |

## Shared work (all members)

- Design reviews of every phase and approval of each Terraform plan before apply.
- Test runs and debugging; GitHub repository and pull request review (PR #1).
- Final validation and preparation of the project review.

## Project totals at submission

| Item | Value |
|---|---|
| Automated tests | backend 77, frontend 11, Terraform 27, all passing |
| AWS (when deployed) | bootstrap 17 + dev 54 resources, all from Terraform |
| Security checks | TFLint 0, Trivy IaC 138/0, 0 secrets in repository/history |
| Region / scaling | ap-southeast-2, ASG 1/1/2, request-based target tracking |
| Images | current `f85f094`, rollback `a0cbc11` (ECR) |
