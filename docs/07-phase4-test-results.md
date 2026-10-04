# 07 — Phase 4 Test Results: Application, Auto Scaling and Recovery

> Run on **2026-10-04** against the dev stack in **ap-southeast-2** (AWS project `cc-project`, Free plan).
> Times are IST (UTC+5:30). Raw evidence is in [`docs/evidence/phase4/`](evidence/phase4/). The load script is [`loadtest/scaleout-ramp.js`](../loadtest/scaleout-ramp.js).

## Summary

| # | Test | Result | Key measurement |
|---|---|---|---|
| 1 | Basic application | **PASS** | Checkout 201 `PAID`; stock 15 → 13 for 2 units |
| 2 | Idempotency | **PASS** | Same key → 200, `Idempotent-Replayed: true`, same order, stock unchanged |
| 3 | Auto Scaling scale-out | **PASS** | 1 → 2 instances; alarm → 2 healthy targets in ≈ 2 m 46 s; 0 errors |
| 4 | Auto Scaling scale-in | **PASS** | 2 → 1 instances 16 m 47 s after load stopped (needed a light trickle of traffic, §4) |
| 5 | Instance failure / recovery | **PASS** | Replacement launched in 12 s; ≈ **1 m 44 s outage** with `min = 1`; data intact |
| 6 | Monitoring validation | **PASS** | Per-instance CloudWatch log streams, 0 error logs, metrics match timeline, SSM Online |

## Environment under test

| Item | Value |
|---|---|
| App URL | `http://cc-checkout-dev-alb-878178869.ap-southeast-2.elb.amazonaws.com` |
| Image | ECR `cc-checkout:8bc96ee` (every response and log line reports `version: 8bc96ee`) |
| ASG | min 1 / desired 1 / max 2 (max limited by the 5-vCPU quota), `t3.micro` |
| Scale-out policy | Target tracking, `ALBRequestCountPerTarget` = 300 → alarm when > 300 for **3 consecutive 1-min** periods |
| Scale-in | Alarm when < 210 req/target **and** CPU < 42 % for **15 consecutive 1-min** periods (target tracking scales in only when all policies agree) |
| Other policy | CPU target 60 % |
| NAT Gateway | none |

## 1. Basic application test — PASS

| Check | Result |
|---|---|
| `GET /api/health` | 200 `{"status":"ok"}` |
| `GET /api/health/ready` | 200 `{"status":"ready","database":"ok"}` (TLS connection to RDS) |
| `GET /` | 200 `text/html` (React SPA) |
| `GET /api/products` | 200, 12 products |
| `POST /api/orders` (2 × product 4, test card `4242…`) | **201**, status `PAID`, total 37,998.00, order `6051a2db-1991-408c-87ee-f188ac40c704` |
| Stock of product 4 | **15 → 13** (expected 13) |
| `GET /api/orders/{id}` | `PAID`, items `[(4, 2)]` |

## 2. Idempotency test — PASS

The identical request was sent again with the same `Idempotency-Key`.

| Check | Result |
|---|---|
| HTTP status | **200** (first request: 201) |
| `Idempotent-Replayed` header | **true** (first request: false) |
| Order ID | identical to the first request |
| Stock of product 4 | **13** (not decremented a second time) |

## 3. Auto Scaling scale-out — PASS

**Method.** k6 sent read-only traffic through the ALB (70 % `GET /api/products?limit=20`, 30 % `GET /api/instance`). It ran ~3 req/s for 3 min (below the threshold), then ramped to ~7 req/s (≈ 420 req/target/min, above the threshold). The load was stopped once scale-out was confirmed. Total: **4,367 requests** in ~13 min. No orders were created.

| Time (IST) | Event |
|---|---|
| 14:43 | Load starts (warm-up), 1 healthy instance `i-0c9782ca1311fddb7` (ap-southeast-2a) |
| 14:44–14:46 | 164–209 req/target/min, below threshold, alarm `OK` |
| 14:47–14:52 | **389, 421, 420, (292\*), 420, 420** req/target/min |
| 14:52:52 | `AlarmHigh` (RequestCountPerTarget) → ALARM; desired **1 → 2** |
| 14:53:05 | `i-02ef225f7b57f96e3` launched (ap-southeast-2b) |
| ≈ 14:55:38 | Both targets **healthy**; ≈ **2 m 46 s** from alarm to 2 healthy targets |
| 14:56:15 | Load stopped |

\* The 14:50 dip is the client-side DNS failure described in §7, not reduced server capacity.

| Metric | Value |
|---|---|
| Peak `RequestCountPerTarget` | **421** per minute (threshold 300) |
| Peak EC2 CPU (ASG max) | **1.9 %**. CPU never approached its 60 % target, so the **request-count policy alone** triggered the scale-out |
| Traffic on both instances | 30 samples of `/api/instance` after scale-out: **16 × `i-02ef225f7b57f96e3`, 14 × `i-0c9782ca1311fddb7`** |
| ALB 5xx / target 5xx / target 4xx | **0 / 0 / 0** during the load |
| Target response time | p50 2.7 ms, p95 4.6 ms, p99 15 ms (ALB `TargetResponseTime`) |
| k6 response time (client in India → Sydney) | p50 317 ms, p95 346 ms (mostly network round-trip) |

Time from load first exceeding 300 req/target/min to the scale-out decision is ≈ 6 min. That's the 3-minute alarm window plus CloudWatch metric publishing delay.

## 4. Auto Scaling scale-in — PASS

| Time (IST) | Event |
|---|---|
| 14:56:15 | Load stopped (2 instances) |
| 15:01:40 | Light background trickle started: 1 request every 10 s (~6 req/min, ~3 req/target/min) |
| 15:13:02 | `AlarmLow` (RequestCountPerTarget) → ALARM; desired **2 → 1** |
| 15:13:10 | `i-02ef225f7b57f96e3` deregistered (30 s connection draining) and terminated |
| 15:14:23 | Scale-in activity complete: 1 instance, healthy |

**Scale-in time: 16 m 47 s after the load stopped**, consistent with the 15 × 1-min evaluation window.

**Why the trickle was needed.** With **zero** requests the ALB publishes **no** `RequestCountPerTarget` datapoints. The low-request alarm then has nothing to evaluate and keeps its previous state. Target tracking scales in only when every policy agrees, so a completely idle stack can stay at 2 instances. A production site always has some background traffic. The trickle (~1.5 % of the threshold) reproduces that and does not influence the decision. **The scaling policy was not changed.** It works as designed, and this behaviour is noted for the report.

## 5. Instance failure and recovery — PASS

**Method.** With the stack stable at 1 instance, `i-0c9782ca1311fddb7` was terminated through the Auto Scaling API (`terminate-instance-in-auto-scaling-group --no-should-decrement-desired-capacity`). A probe called `GET /api/instance` through the ALB every ~2 s. No other resource was touched.

| Time (IST) | Event |
|---|---|
| 15:15:26 | Termination requested |
| 15:15:34 | Last successful response from the old instance |
| 15:15:38 | First failed probe (ALB **503**, no registered targets) |
| 15:15:39 | ASG launches replacement **`i-07ca510c699761eee`** (ap-southeast-2b), **12 s** after termination |
| 15:16:38 | Old instance terminated |
| ≈ 15:16:40–15:17:17 | ALB returns **502**: with no healthy target the ALB "fails open" to the still-booting instance |
| 15:17:20 | First successful response from the replacement |

| Measurement | Value |
|---|---|
| Application outage | **≈ 1 m 44 s** (15:15:36 → 15:17:20); 32 failed probes (5 × 503, 27 × 502) |
| Termination request → service restored | ≈ 1 m 54 s |
| After recovery | 12/12 probes 200; `/api/health/ready` → `database: ok` |
| Data durability | Order `6051a2db-…` still `PAID`; product 4 stock still **13**. State lives in RDS, not on the instance |

**Cost/availability trade-off.** With `asg_min_size = 1` there is no second instance to absorb the failure, so an outage of about one boot time (install Docker, pull the image, run migrations, pass 2 health checks) is expected. Running `min = 2` across both AZs would make a single-instance failure invisible to users. It would also double the EC2 + public-IP cost (≈ +$0.02/h) and use 4 of the project's 5 vCPUs. For a coursework dev environment on the Free plan, `min = 1` is the deliberate choice. Production would use `min ≥ 2`.

## 6. Monitoring validation — PASS

| Check | Result |
|---|---|
| CloudWatch Logs `/cc-checkout/dev/app` | One stream per instance (`i-0c9782…`, `i-02ef225…`, `i-07ca510…`). The replacement logged migrations, `Checkout API listening` and each request, all tagged `version: 8bc96ee` |
| Error-level logs (`level >= 50`) | **0** across all streams |
| ALB metrics | `RequestCount`, `RequestCountPerTarget`, `HealthyHostCount`, `HTTPCode_ELB_5XX_Count` match the timeline. All **32** ELB 5xx fall in the 15:15–15:17 failure window, matching the 32 failed probes. `HTTPCode_Target_5XX_Count` = **0** for the whole session |
| ASG metrics | `GroupDesiredCapacity` / `GroupInServiceInstances` show 1 → 2 → 1 → (replace) 1 |
| Scaling activity history | Records the alarm, policy and instance for every step (scale-out, scale-in, replacement) |
| SSM | Replacement `i-07ca510c699761eee` **Online** (Session Manager reachable, no SSH) |

## 7. k6 client-side failures (not AWS errors)

k6 reported **109 failed requests (2.5 %)**, so its `http_req_failed < 1 %` threshold failed (exit code 105). All 109 failures:
- occurred in **one 13-second window** (09:20:18–09:20:31 UTC = 14:50:18–14:50:31 IST);
- have the error `lookup cc-checkout-dev-alb-….elb.amazonaws.com on 192.168.65.7:53: no such host`. 192.168.65.7 is **Docker Desktop's internal DNS resolver** on the test laptop.

The requests never left the test machine. The ALB recorded **no** errors in that minute (`HTTPCode_ELB_5XX_Count` and `HTTPCode_Target_5XX_Count` both 0), so these are **not application or AWS failures**. Excluding them, the client-observed success rate was 100 %. Evidence: [`k6-output.log`](evidence/phase4/k6-output.log).

## 8. State after testing

| Item | Value |
|---|---|
| Running instances | **1**: `i-07ca510c699761eee` (ap-southeast-2b), healthy, SSM Online |
| Deployed image | `8bc96ee` |
| Terraform (`infra/envs/dev`) | `plan` → **0 changes** (45 resources) |
| NAT Gateway | none |
| RDS | `cc-checkout-dev-postgres` available, private, `rds.force_ssl = 1`, backups 1 day |
| Approximate running cost | **≈ $0.10/hour** (1 instance) |
| Test data created | 3 orders: 2 smoke-test orders during deployment verification, 1 test order here (its idempotent replay created nothing) |

## Evidence files

| File | Content |
|---|---|
| [`evidence/phase4/k6-summary.json`](evidence/phase4/k6-summary.json) | k6 summary export (request counts, latency percentiles, checks) |
| [`evidence/phase4/k6-output.log`](evidence/phase4/k6-output.log) | k6 console output, including the 109 client-side DNS failures |
| [`evidence/phase4/asg-watch.log`](evidence/phase4/asg-watch.log) | 30-second samples of ASG desired/instances, target health, req/min, req/target, CPU, alarm state |
| [`evidence/phase4/failure-probe.log`](evidence/phase4/failure-probe.log) | 2-second probe of `/api/instance` during the instance-failure test |
