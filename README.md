# Auto-Scaling E-Commerce Checkout System on AWS (Terraform)

A cloud computing course project: a React + Node.js checkout application deployed on AWS. It runs on EC2 instances in an Auto Scaling Group behind an Application Load Balancer, uses RDS PostgreSQL for storage, and is monitored with CloudWatch. All infrastructure is provisioned with Terraform.

**Current status:** Phase 4 in progress. The bootstrap stack (S3 state and artifacts buckets, ECR repository, $10 budget alert) is deployed in AWS project `cc-project`. The dev stack (45 resources, about $0.10/h with 1 instance) is **running** for testing. Run `terraform destroy` in `infra/envs/dev` when you finish. Region: ap-southeast-2 (Sydney).

| Doc | Contents |
|---|---|
| [docs/01-architecture.md](docs/01-architecture.md) | Architecture diagram, design decisions, networking, concurrency, observability, SLA |
| [docs/02-api-and-data-model.md](docs/02-api-and-data-model.md) | REST endpoints, schema, checkout algorithm |
| [docs/03-syllabus-mapping.md](docs/03-syllabus-mapping.md) | Unit I–VI mapping and deliberate exclusions |
| [docs/04-cost-estimate.md](docs/04-cost-estimate.md) | Hourly/monthly costs and guardrails |
| [docs/05-implementation-plan.md](docs/05-implementation-plan.md) | Repository layout, phase plan, prerequisites |
| [docs/06-infrastructure.md](docs/06-infrastructure.md) | Terraform stacks and modules, validation results, AWS prerequisites, deploy runbook |
| [docs/07-phase4-test-results.md](docs/07-phase4-test-results.md) | Phase 4 test results: checkout, idempotency, scale-out/in, instance failure, monitoring |
| [docs/08-security-review.md](docs/08-security-review.md) | Security review and hardening: IAM, network, EC2, RDS, secrets, container |
| [docs/09-ci-cd.md](docs/09-ci-cd.md) | CI (GitHub Actions), deployment script, rollback, why there is no GitHub OIDC |
| [loadtest/](loadtest/README.md) | k6 load-test scripts and how to run them |

## Repository layout

```
backend/     Express API (src/), SQL migrations + seed, tests, Dockerfile
frontend/    React + Vite SPA, tests
docker/      Postgres init script (creates the checkout_test database)
infra/       Terraform: bootstrap/ (state, ECR, budget), modules/, envs/dev/
docker-compose.yml, .env.example
docs/        Design documentation
```

## Run locally (Docker Compose)

Requires Docker Desktop to be running. All commands are run from the repository root.

```powershell
copy .env.example .env          # first time only; then edit POSTGRES_PASSWORD in .env
docker compose up --build -d    # build the image and start Postgres + app
```

Open **http://localhost:3000**. Mock test cards:
- `4242 4242 4242 4242`: approved
- `4000 0000 0000 0002`: declined

Use any future expiry date (e.g. `12/30`) and any 3-digit CVC.

```powershell
docker compose logs -f app      # follow the app's JSON logs
docker compose down             # stop (database data is kept)
docker compose down -v          # stop AND delete the local database
```

Ports: the app runs on `localhost:3000`, and the Docker Postgres runs on `localhost:5433`. 5433 is used because a natively installed PostgreSQL already uses 5432. You can change either port in `.env`.

## Run tests

The backend integration tests need the Docker Postgres running (`docker compose up -d db`). They use a separate `checkout_test` database, so your local app data is never touched.

```powershell
cd backend
npm install
npm test                 # unit + integration
npm run test:unit        # unit only (no database needed)

cd ..\frontend
npm install
npm test
```

## Frontend development with hot reload (optional)

```powershell
docker compose up -d db
docker compose stop app         # free port 3000 if the container app is running

# Terminal 1 — API with auto-restart (use the password from your .env)
cd backend; $env:DATABASE_URL="postgres://checkout:<password>@localhost:5433/checkout"; npm run dev

# Terminal 2 — React dev server: http://localhost:5173 (/api is proxied to :3000)
cd frontend; npm run dev
```

## API at a glance

`GET /api/health` · `GET /api/health/ready` · `GET /api/instance` · `GET /api/products` · `GET /api/products/:id` · `POST /api/cart/quote` · `POST /api/orders` (requires `Idempotency-Key`) · `GET /api/orders/:id`

Full details are in [docs/02-api-and-data-model.md](docs/02-api-and-data-model.md).

## Infrastructure (Terraform)

See [docs/06-infrastructure.md](docs/06-infrastructure.md) for the module overview, offline validation commands (`terraform validate`, `terraform test`, TFLint, Trivy), the AWS-side prerequisites, and the Phase 4 deploy/destroy runbook.
