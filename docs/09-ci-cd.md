# 09 — CI/CD (Phase 5, increment 4)

> **Design constraint.** The AWS project (new AWS sign-up experience) has an AWS-managed service control policy that **denies `iam:*Provider*`** on both the Free and the Paid plan. `aws iam list-open-id-connect-providers` returns *"explicit deny in a service control policy"*. GitHub Actions OIDC needs an IAM OIDC identity provider for `token.actions.githubusercontent.com`, so **it cannot be created in this account**. The only way to lift the restriction is to upgrade and "activate advanced AWS features", which is irreversible and removes spend limits. Long-lived access keys in GitHub were ruled out.
>
> **Chosen design:** GitHub Actions does all of **CI** with **no AWS access at all**. **CD** is one operator command, `scripts/deploy.sh`, run with the operator's short-lived `aws login` session. It reuses the existing Terraform rolling deployment and adds guard rails and verification. No AWS resources were added for CI/CD.

## Architecture

```
 developer ──push / PR──▶ GitHub (private repo)
                              │
                              ▼
                 GitHub Actions "CI" (.github/workflows/ci.yml)
                 permissions: contents: read   ·   no AWS credentials, no OIDC
                 ┌───────────┬────────────┬──────────────┬─────────────┐
                 │ backend   │ frontend   │ terraform    │ secrets     │
                 │ unit +    │ tests +    │ fmt/validate │ Trivy       │
                 │ integr.   │ build +    │ test (mock)  │ secret scan │
                 │ (Postgres)│ npm audit  │ TFLint/Trivy │             │
                 └─────┬─────┴─────┬──────┴──────┬───────┴──────┬──────┘
                       └───────────┴──── image ──┴──────────────┘
                         build linux/amd64 · non-root check · Trivy image
                         scan · smoke run with production hardening flags
                              │ (green on main)
                              ▼
 operator ── scripts/deploy.sh ──(aws login, profile cc-project)──▶ AWS
     1 build image (if not in ECR) → push cc-checkout:<git-sha> (immutable)
     2 image_tag in terraform.tfvars → terraform plan
     3 GUARD: refuse unless only launch template user_data + ASG version change
     4 terraform apply → existing rolling instance refresh (min 50% healthy)
     5 wait: refresh Successful, all targets healthy, only <git-sha> served
     6 verify /api/health, /api/health/ready (database ok), products, SPA
       (+ optional checkout and idempotent-replay smoke test)
     7 terraform plan must show no changes
```

## GitHub Actions workflow (`.github/workflows/ci.yml`)

**Triggers:** `pull_request` to `main`, `push` to `main`, and manual `workflow_dispatch`. PR runs are cancelled when a newer commit arrives.

| Job | What it does | Fails the build when |
|---|---|---|
| `backend` | `npm ci`; unit tests; integration tests against a throwaway `postgres:16-alpine` service container; `npm audit --omit=dev --audit-level=high` | any test fails, or a HIGH/CRITICAL production dependency vulnerability is found |
| `frontend` | `npm ci`; Vitest; `vite build`; `npm audit` (production) | as above, or the build fails |
| `terraform` | `fmt -check`; `init -backend=false` + `validate` (bootstrap, envs/dev); `terraform test` with the **mock AWS provider** (envs/dev, compute, monitoring, network, security); TFLint (AWS ruleset); Trivy IaC scan | any finding (accepted risks are annotated inline) |
| `secrets` | Trivy secret scan of every tracked file | any secret found |
| `image` (needs all above) | Builds the production image (linux/amd64, tag = 7-char git SHA, **not pushed**); asserts it runs as `node`; Trivy image scan (HIGH/CRITICAL with a fix + secrets); runs it with the **same hardening flags as EC2** and checks `/api/health`, the SPA, a read-only root FS and zero capabilities | any of these checks fails |

Security properties:
- `permissions: contents: read` for the whole workflow, `persist-credentials: false` on every checkout.
- **No `id-token: write`, no AWS credentials, no repository secrets.** The only credential the workflow uses is GitHub's own short-lived, read-only `GITHUB_TOKEN`, passed to TFLint to avoid download rate limits.
- Third-party actions are pinned to **full commit SHAs** (the tag is in a comment). Trivy and TFLint run from pinned official container images (`aquasec/trivy:0.75.0`, `ghcr.io/terraform-linters/tflint:v0.64.0`).
- The test database password in the workflow is a fixed throwaway value for a container that exists only during the job. It is not a secret.

**Required GitHub configuration:** none. No secrets or variables are needed. (Optional: branch protection on `main` requiring the `CI` checks to pass.)

## Deployment (`scripts/deploy.sh`)

Run from the repository root (Git Bash on Windows, or any bash) on a **clean checkout of the commit that passed CI**:

```bash
aws login --region ap-southeast-2 --profile cc-project   # once per day (session expires)
scripts/deploy.sh                    # build + push this commit's image, then deploy it
scripts/deploy.sh --checkout-smoke   # also place 1 test order + replay it
scripts/deploy.sh --yes              # no confirmation prompt
scripts/deploy.sh --plan-only        # plan + guard only, apply nothing
```

Re-running the script for a tag that is already deployed applies nothing and runs the full verification against the live deployment (useful as a health check).

Prerequisites: AWS CLI v2, Terraform ≥ 1.10, Docker running, Python 3, `infra/envs/dev/terraform.tfvars` and `backend.hcl` (git-ignored; see the `.example` files).

| Step | Detail |
|---|---|
| Tag | `git rev-parse --short=7 HEAD`. The working tree must be clean, so the tag always identifies the code exactly. Same scheme as CI |
| Build & push | Skipped if the tag already exists in ECR (tags are **immutable**). The ECR login runs inside a throwaway `docker:cli` container, so the token never reaches the host credential store or disk |
| Plan guard | The plan is parsed (`terraform show -json`). Anything other than an **in-place update of the launch template (`user_data`) and the ASG (`launch_template` version, min/max unchanged)** aborts the deployment before apply. If the plan is empty, the tag is already deployed and nothing happens |
| `terraform.tfvars` | Updated only after a successful apply. On any earlier failure the previous tag is restored |
| Rollout | The existing ASG instance refresh (`min_healthy_percentage = 50`, `skip_matching`). ASG sizes are not touched (1/1/2) |
| Success criteria | Refresh `Successful`; every target `healthy`; `/api/instance` returns only the new version; `/api/health` 200; `/api/health/ready` → `database: ok`; products API and SPA load; optional checkout + idempotent replay; final `terraform plan` shows **no changes** |

## Rollback

```bash
scripts/deploy.sh --rollback <previous-tag>     # e.g. a0cbc11
```

Redeploys an image that is already in ECR (no build), through the same guard, rolling refresh and verification. The script prints the exact rollback command after every deployment. The ECR lifecycle policy keeps the **last 5 tagged releases**, and no step deletes images.

Database note: migrations are forward-only and additive (new enum value, nullable column, index), so an older image keeps working against the newer schema. An image older than `a0cbc11` does not know the `EXPIRED` status and would replay an expired checkout as a 200 with `status: EXPIRED`.

## IAM

| Identity | Used by | Permissions |
|---|---|---|
| GitHub Actions | CI | **None in AWS.** Read-only `GITHUB_TOKEN` in GitHub |
| Operator (`aws login`, project role) | `scripts/deploy.sh` | The operator's own project role. Short-lived browser-login credentials; no access keys exist |
| EC2 instance role | the app | Unchanged (docs/08) |

No IAM role, user, access key or OIDC provider was created for CI/CD.

## If OIDC becomes possible later

After "activate advanced AWS features", or in a standard AWS account, the deploy step can move into GitHub Actions without changing the rest:
1. Terraform: `aws_iam_openid_connect_provider` for `https://token.actions.githubusercontent.com` (audience `sts.amazonaws.com`).
2. A deploy role trusting it **only** for `repo:Ayush32-creator/CC_AWS_AUTO_SCALING:ref:refs/heads/main` (and/or a GitHub `environment`).
3. Least-privilege permissions:
   - ECR push to `cc-checkout`;
   - S3 read/write on the state object and lock file;
   - the read-only `Describe*`/`Get*`/`List*` calls Terraform needs to refresh state;
   - `ec2:CreateLaunchTemplateVersion` / `ModifyLaunchTemplate` on the app launch template;
   - `autoscaling:UpdateAutoScalingGroup` / `StartInstanceRefresh` on the app ASG;
   - `iam:PassRole` for the instance role only.
4. A `deploy` job with `permissions: id-token: write`, gated on the `image` job and `github.ref == 'refs/heads/main'`, running `scripts/deploy.sh --yes`.

## Verification results (2026-10-05)

| Check | Result |
|---|---|
| Repository | `Ayush32-creator/CC_AWS_AUTO_SCALING`, **private**. GitHub repo secrets: **0**, variables: **0**, environments: **0** |
| First CI run on `main` (`d9b1f17`) | backend, frontend, Terraform and secret jobs passed; **image job failed**: Trivy found 10 HIGH CVEs, all in the npm CLI bundled with `node:22-alpine` (`/usr/local/lib/node_modules/npm`: brace-expansion, ip-address, pacote, picomatch, sigstore). The gate worked as intended |
| Fix via **pull request #1** (`4a3fe92`) | npm/npx, corepack and yarn removed from the runtime stage (the app never uses them). **PR CI: all 5 jobs green**. Every job's `GITHUB_TOKEN` had only `Contents: read` + `Metadata: read`. 0 AWS-related strings in the logs; nothing deployed |
| `main` CI after merge (`24db594`, `d629ab9`, `f85f094`) | all 5 jobs green on every push |
| Deploy-script issues found during the test | Two runs stopped **safely at the plan guard** (a Python quoting bug, then Windows Python unable to read Git Bash's `/tmp`). Each time nothing was applied and `terraform.tfvars` was restored. The verification loop then never matched because native Windows tools emit `` in pipes, and `curl -o /dev/null` failed under `MSYS_NO_PATHCONV`. All fixed (`f85f094` + follow-up), the guard was tested against a real and a tampered plan (tampered → refused), and the final script passes ShellCheck |
| Deployment of `f85f094` | build → ECR push (immutable tag) → guard (only launch template `user_data` + ASG `launch_template`) → apply **0 add / 2 change / 0 destroy** → instance refresh Successful. `i-0f728c5cdb3aa7aa2` (`a0cbc11`) → **`i-03cab923030c37dd0`** (`f85f094`) |
| Availability during rollout | **301/301 probes HTTP 200** (no downtime; both versions served briefly during the overlap) |
| Post-deploy verification (script) | target healthy, only `f85f094` served; `/api/health` 200; `/api/health/ready` → `database: ok`; products and SPA OK; **checkout 201 PAID** (`e5e0216f-…`) and **idempotent replay 200 (same order)**; final `terraform plan` → **no changes** |
| CloudWatch | new instance stream: `Checkout API listening`, `Pending-order reaper started`, the smoke checkout (`paid`, 213 ms) and its replay; **0 error lines**. All 4 alarms **OK** |
| ECR | tagged releases: `f85f094` (running), `d629ab9`, `24db594`, `a0cbc11` (previous working image, rollback target), `8bc96ee`. `f85f094` scan: **0 findings**. The lifecycle policy keeps the newest 5, so the next release will expire `8bc96ee` |
| AWS resources added for CI/CD | **none** |

