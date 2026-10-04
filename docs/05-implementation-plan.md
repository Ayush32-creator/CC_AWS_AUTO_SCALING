# 05 — Implementation Plan

Each phase ends with a summary and waits for your approval before the next one starts.

## Target repository structure

```
CC_CP/
├── frontend/                 React + Vite SPA (product list, cart, checkout, order status)
│   ├── src/  (api client, pages, components, cart store)
│   └── tests/                Vitest + React Testing Library
├── backend/                  Node 20 + Express API
│   ├── src/  (routes/, services/, db/, middleware/, payment/, metrics/)
│   ├── migrations/           SQL migrations + seed
│   ├── tests/unit/ · tests/integration/   Vitest + supertest
│   └── Dockerfile            multi-stage: build frontend → slim runtime
├── infra/
│   ├── bootstrap/            S3 state, ECR, GitHub OIDC role, Budget
│   ├── modules/              network · security · database · alb · compute · monitoring
│   └── envs/dev/             composes modules; *.tfvars.example
├── loadtest/                 k6 scripts (browse, checkout ramp, duplicate-submit, soak)
├── scripts/                  deploy / push-image / destroy helpers
├── .github/workflows/        ci.yml, deploy.yml
├── docs/                     architecture, API, mapping, costs, results, report outline
├── docker-compose.yml        local Postgres + app
└── README.md
```

## Status

| Phase | Status |
|---|---|
| 1 Planning | ✅ Approved |
| 2 Application | ✅ Approved |
| 3 Docker + IaC | ✅ Complete |
| 4 Deploy + scaling | ✅ Complete: deployed 2026-10-04; all 6 application/scaling/recovery tests passed (docs/07) |
| 5 Ops & security | 🟡 In progress: increment 1 (CloudWatch) deployed 2026-10-04; increment 2 (pending-order reaper) deployed as image `a0cbc11` 2026-10-04; increment 3 (security/IAM hardening) deployed and verified 2026-10-05 (docs/08) |
| 6 | Not started |

Decisions: region **ap-southeast-2 (Sydney)**, the Region assigned to the AWS project (changed from ap-south-1 in Phase 4). Git is initialised with one commit per phase and no remote push.

## Phases

| Phase | Key tasks | Done when… | AWS cost |
|---|---|---|---|
| **1 Planning** | Architecture, API, schema, mapping, cost (these docs) | You approve | $0 |
| **2 App** | Express API, migrations, idempotent checkout, React UI, unit + integration tests, docker-compose for local Postgres | `npm test` passes; full checkout works at `localhost`; concurrent duplicate-key test creates exactly 1 order | $0 |
| **3 Docker + IaC** | Dockerfile, all Terraform modules, `fmt`/`validate`/`tflint`, `terraform plan` (no apply) | Image runs locally; `terraform validate` is clean; plan reviewed with you | $0 (plan only) |
| **4 Deploy + scaling** | Apply bootstrap, push image, apply dev, verify ALB/health checks, ASG scale-out/in | App reachable through the ALB; instance count changes under load | ~$0.14/h, **with your approval** |
| **5 Ops & security** | Dashboard, alarms, log metric filters (`OrdersPlaced`/`OrdersFailed`/`CheckoutLatency`), IAM review, CI/CD workflows with a GitHub OIDC role, SLA/cost docs. **Stale-`PENDING` order reaper** (found in Phase 2; see docs/06 §6). Optional least-privilege `app_user` for the DB. | Alarms fire in a test; CI is green; a stale `PENDING` order is released by the reaper in an integration test | Included above |
| **6 Load test & report** | k6 ramp/spike/duplicate tests, failure drills (terminate instance, reboot RDS), graphs, final report | Results tables + screenshots in `docs/` | ~$1–2 |

## Prerequisites to install (needed from Phase 2 / 3 / 4)

Run in PowerShell. Docker Desktop requires WSL2, which is already present.

```powershell
winget install -e --id Docker.DockerDesktop      # Phase 2 (local Postgres) — reboot afterwards
winget install -e --id Hashicorp.Terraform       # Phase 3
winget install -e --id Amazon.AWSCLI             # Phase 4
winget install -e --id GrafanaLabs.k6            # Phase 6
```

Verify:
```powershell
docker --version; terraform -version; aws --version; k6 version
```

For Phase 4 you will also need an AWS account and an IAM user or SSO profile for **your own** CLI use (`aws configure sso` or `aws configure`). Credentials stay in `~/.aws` and are never put in the repo.
