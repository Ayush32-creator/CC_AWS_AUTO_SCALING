# 10 — Phase 6: Load Testing and Performance Validation

> Run on **2026-10-05** against the dev stack in **ap-southeast-2**, which was recreated for this phase from the unchanged Terraform configuration (image `f85f094`, ASG 1/1/2, no NAT).
> Times are **IST (UTC+5:30)** unless marked UTC. Every number below is a measurement; raw data is in [`loadtest/results/`](../loadtest/results/).

## Summary

| Item | Result |
|---|---|
| Requests sent by k6 | **6,400** in 19 min (5.61 req/s average); **6,326 successful (98.84 %)** |
| Failed requests | **74 (1.16 %)**, all **client-side network errors** on the test laptop between 12:30:08 and 12:31:06. The ALB recorded **0 × 5xx and 0 × 4xx** for the whole run |
| Requests received by the ALB | 6,419 (k6 + a few verification requests) |
| Server-side latency (ALB `TargetResponseTime`) | p50 **2.7–3.6 ms**, p95 **4.4–21 ms**, p99 ≤ **210 ms** (per-minute values) |
| Client-side latency (k6 on the test laptop, ~237 ms network RTT to Sydney) | p50 **320 ms**, p95 **862 ms** (overall; p99 and max are inflated by the client outage) |
| Scale-out 1 → 2 | alarm **12:28:08**; second instance launched 12:28:19; **2 healthy targets at 12:31:27** (3 min 19 s after the alarm) |
| Scale-in 2 → 1 | load stopped 12:38:44; alarm **12:55:53** (17 min 09 s later); termination complete **12:56:54** |
| Peak resource use | EC2 CPU **2.0 %** (max), RDS CPU **7.1 %** (max), RDS connections **6** (max) |
| Application after the load | checkout 201 `PAID`, stock 45 → 43, idempotent replay 200 with the same order and stock still 43; 0 error logs; all alarms OK |

## 1. Method

### Test environment

| Item | Value |
|---|---|
| Stack | `infra/envs/dev` recreated with `terraform apply`: plan **54 to add / 0 change / 0 destroy**, applied in 9 min 42 s (06:05:22 → 06:15:04 UTC). Bootstrap untouched |
| Application | ECR `cc-checkout:f85f094`; verified with `scripts/deploy.sh --rollback f85f094 --checkout-smoke` before testing (target healthy, readiness `database: ok`, checkout 201 + replay 200, plan clean) |
| ALB | `cc-checkout-dev-alb-1172020482.ap-southeast-2.elb.amazonaws.com` (HTTP) |
| Scaling policy (unchanged) | target tracking: `ALBRequestCountPerTarget` = 300 per minute (scale-out after 3 consecutive minutes above; scale-in after 15 consecutive minutes below 210 **and** CPU below its low threshold) + CPU 60 % |
| Load generator | **k6 v2.2.0, native Windows binary** on the developer laptop (instead of Docker, to save RAM), ~237 ms RTT to Sydney |
| Monitoring during the run | [`loadtest/watch-scaling.sh`](../loadtest/watch-scaling.sh): ASG, target health and CloudWatch every ~30–60 s → [`results/phase6-timeline.txt`](../loadtest/results/phase6-timeline.txt) |

### Workload ([`loadtest/phase6-load.js`](../loadtest/phase6-load.js))

Read-only but **database-backed** traffic. No orders are created during the load, so stock is not consumed:

| Request | Share | Touches |
|---|---|---|
| `GET /api/products?limit=20` | 50 % | RDS (list + count) |
| `GET /api/products/{1..12}` | 20 % | RDS |
| `POST /api/cart/quote` (2 products) | 15 % | RDS (server-side pricing) |
| `GET /api/instance` | 15 % | instance metadata (shows which instance answered) |

| Scenario | Executor | Rate | Duration (start) |
|---|---|---|---|
| `baseline` | constant arrival rate | 2 req/s (~120/min) | 3 min (0:00) |
| `ramp` | ramping arrival rate | 2 → 7 req/s | 1 min (3:00) |
| `sustained` | constant arrival rate | 7 req/s (~420/min: above 300/target with 1 instance, ~210/target with 2) | 15 min (4:00) |

After k6 finished, a **trickle of 1 request every 10 s** (~6/min) ran until scale-in completed. Phase 4 showed that with zero traffic the ALB publishes no `RequestCountPerTarget` datapoints, so the scale-in alarm cannot evaluate. **The scaling policy was not changed.**

## 2. Results by phase

### k6 (client view, including ~237 ms network RTT from the test laptop to Sydney)

| Scenario | Requests | Failed | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|
| baseline | 361 | **0** | 450 ms | 664 ms | 736 ms | 1,222 ms | 1,740 ms |
| ramp | 269 | **0** | 384 ms | 558 ms | 580 ms | 651 ms | 780 ms |
| sustained | 5,770 | 74 (1.28 %)\* | 315 ms | 558 ms | 959 ms | 11,927 ms\* | 60,002 ms\* |
| **all** | **6,400** | **74 (1.16 %)\*** | **320 ms** | **565 ms** | **862 ms** | 11,043 ms\* | 60,002 ms\* |

\* Caused by the client outage (§5). `max` = k6's 60 s request timeout. Throughput: 6,400 requests in 1,140 s = **5.61 req/s**. 531 iterations were **dropped** by k6 (not sent) while its virtual users were blocked by those timeouts. Data received 12.0 MB, sent 0.98 MB.

### ALB / EC2 / RDS (server view, CloudWatch, per minute)

Full table: [`results/phase6-cloudwatch-minutes.txt`](../loadtest/results/phase6-cloudwatch-minutes.txt).

| Minute (IST) | Phase | ALB req | req/target | in service | p50 / p95 / p99 (ms) | EC2 CPU max | RDS CPU max | RDS conn |
|---|---|---|---|---|---|---|---|---|
| 12:20–12:22 | baseline | 120–133 | 120–133 | 1 | 3.3–3.6 / 6.7–12.9 / 19.7–31.7 | 1.1–1.4 % | 4.3–5.3 % | 2 |
| 12:23 | ramp | 346 | 346 | 1 | 3.4 / 7.5 / 17.5 | 1.7 % | 4.8 % | 3 |
| 12:24–12:27 | sustained, 1 instance | 420–421 | 420–421 | 1 | 3.0–3.3 / 6.9–10.3 / 17.9–26.2 | 1.9–2.0 % | 4.7–5.0 % | 4 |
| 12:28 | scale-out decision | 420 | 420 | 2 (launching) | 3.0 / 8.5 / 14.7 | 2.0 % | 4.9 % | 4 |
| 12:29–12:30 | **client outage** | 150, 181 | 150, 100 | 2 | 2.9–3.0 / 6.9–20.0 / 13.1–94.0 | 0.9–1.6 % | 5.2–6.3 % | 3–4 |
| 12:31–12:37 | sustained, 2 instances | 385–453 | 192–226 | 2 | 2.7–2.8 / 4.4–21.0 / 7.9–210.1 | 1.3–1.5 % | 4.6–5.8 % | 4–6 |
| 12:38 | load ends 12:38:44 | 295 | 148 | 2 | 2.7 / 4.6 / 16.7 | 1.3 % | 7.1 % | 4 |

Totals for 12:17–12:39: **6,419 requests, ELB 5xx 0, target 5xx 0, target 4xx 0.** Peak request count per target **421/min**. Peak EC2 CPU **2.0 %**, RDS CPU **7.1 %**, RDS connections **6** (of ~80 available; the pool allows 10 per instance).

## 3. Auto Scaling timeline

| Time (IST) | UTC | Event | Source |
|---|---|---|---|
| 12:15:04 | 06:15:04 | Stack created; `i-0648db399fc532913` (ap-southeast-2b) in service | Terraform / ASG activity |
| 12:19:43 | 06:49:43 | k6 starts (baseline) | `results/phase6-run-info.txt` |
| 12:23 (minute) | — | first minute above 300 req/target (346) | CloudWatch |
| **12:28:08** | 06:58:08 | `AlarmHigh` (RequestCountPerTarget) → ALARM; desired **1 → 2** | ASG activity |
| 12:28:19 | 06:58:19 | `i-071b5c76b5e007231` (ap-southeast-2a) launched | ASG activity |
| **12:31:27** | 07:01:27 | launch activity Successful: **2 healthy targets** | ASG activity / target health |
| 12:31:56 | — | 30 sample requests: **19 × i-0648db399fc532913, 11 × i-071b5c76b5e007231**, both `f85f094` | `/api/instance` |
| 12:37 (minute) | — | last minute ≥ 210 req/target (211) | CloudWatch |
| 12:38:44 | 07:08:44 | k6 ends | run info |
| 12:39:05 | 07:09:05 | trickle (~6 req/min) starts | `results/phase6-trickle.txt` |
| **12:55:53** | 07:25:53 | `AlarmLow` (RequestCountPerTarget) → ALARM; desired **2 → 1** | ASG activity |
| 12:56:01 | 07:26:01 | `i-0648db399fc532913` deregistered (connection draining) | ASG activity |
| **12:56:54** | 07:26:54 | termination Successful: 1 instance (`i-071b5c76b5e007231`) | ASG activity |

| Measure | Value |
|---|---|
| Load above threshold → scale-out decision | ≈ 5 min (12:23 minute → 12:28:08): the 3-minute alarm window plus CloudWatch publishing delay |
| Scale-out decision → 2 healthy targets | **3 min 19 s** (boot, Docker pull, 2 health checks) |
| Load stopped → scale-in decision | **17 min 09 s** (15-minute evaluation window + delay) |
| Scale-in decision → termination complete | **61 s** (incl. 30 s connection draining) |

The ASG stayed within **min 1 / max 2** throughout. Phase 4 (docs/07) measured the same behaviour: 2 min 46 s to healthy, 16 min 47 s to scale-in.

## 4. Application validation after the load

From [`results/phase6-app-validation.txt`](../loadtest/results/phase6-app-validation.txt), at 13:09:12:

| Check | Result |
|---|---|
| Checkout (2 × product 10) | HTTP **201**, `PAID`, order `72453195-f639-49ff-964c-29fa60bb97ff` |
| Stock | 45 → **43** (expected 43) |
| Replay with the same `Idempotency-Key` | HTTP **200**, `Idempotent-Replayed: true`, same order id |
| Stock after replay | **43**, unchanged: no double deduction |
| CloudWatch `OrdersPlaced` | 1 at 12:03 (pre-test verification) and 1 at 13:09 (this check) |
| CloudWatch `CheckoutLatency` | 154 ms and 183 ms |
| `OrdersFailed` / `AppErrors` | **0 / 0** since the stack was created |
| Error-level application logs (level ≥ 50) | **0** |
| Expired pending orders | 0 (none stuck) |
| Alarms (5xx rate, no healthy targets, p95 latency, RDS CPU) | all **OK** |

## 5. Errors and anomalies (all client-side)

| When (IST) | What | Evidence it was not AWS |
|---|---|---|
| ~12:29:08–12:31:06 | Test laptop lost connectivity: k6 logged **74 failures**: 26 timeouts, 23 "unreachable network", 16 "unreachable host", 8 "connection aborted by the host machine", 1 no response (requests sent from ~12:29:08 timed out at 60 s, so the first failures were logged at 12:30:08) | ALB `RequestCount` fell to 150 and 181 in the 12:29 and 12:30 minutes (requests did not leave the laptop); **ELB 5xx 0, target 5xx 0**; both targets healthy. Log: [`results/phase6-k6-console.txt`](../loadtest/results/phase6-k6-console.txt) |
| ~12:58–13:01 | Second laptop connectivity loss: 19 of 153 trickle requests got no HTTP response (`000`), and the AWS CLI could not reach AWS at the same time | ALB `RequestCount` **0** for the 12:59 and 13:00 minutes, `HealthyHostCount` 1 throughout, 0 5xx |
| ~12:47 | The operator's `aws login` session expired, so the watcher recorded nothing until re-login at ~12:55 | Scale-in timings reconstructed from the ASG activity history and CloudWatch alarm history (authoritative AWS records) |
| 12:08–12:18 | **Discarded first run:** an empty `BASE_URL` (a missing `AWS_PROFILE` in the launch command broke `terraform output`) made every k6 request fail locally; no traffic reached AWS | The run was stopped and its output deleted; `phase6-load.js` now refuses to start without a valid URL |

No application, ALB, EC2 or RDS errors were recorded during Phase 6.

## 6. Failure recovery (not repeated)

As agreed, the instance-termination test was not repeated. Phase 4 (docs/07 §5) measured it: with `min = 1`, terminating the only instance caused a **≈ 1 min 44 s** outage until the replacement passed its health checks, and RDS data stayed intact. Nothing in Phase 6 changes that trade-off.

## 7. Limitations

- **Single load generator on a home connection** ~237 ms from Sydney. Client-side latency is dominated by the network; ALB `TargetResponseTime` is the meaningful server-side latency. The laptop's connection dropped twice during the session (§5).
- **Small load by design** (≤ 7 req/s, AWS Free plan). It proves request-driven scaling, but **CPU never exceeded 2 %**, so the CPU policy and the system's real capacity limit were not reached. A capacity (stress) test was out of scope.
- **Read-heavy mix.** Checkouts were validated separately (1 order) rather than under load, to avoid draining stock. Under concurrent load, correctness of checkout was covered by the integration tests (concurrency, no overselling, idempotency).
- **`asg_max_size = 2`** (5-vCPU project quota). Behaviour beyond 2 instances was not tested.
- **Scale-in needs some traffic.** With zero requests the request-count alarm cannot evaluate (Phase 4 finding); a ~6 req/min trickle was used.

## 8. Conclusions

1. **Scale-out works on request load**: sustained ~420 req/min (above the 300/target target) triggered 1 → 2 after the 3-minute alarm window, and the new instance served traffic **3 min 19 s** after the decision. Traffic was spread across both AZs.
2. **Scale-in works**: 2 → 1 happened **17 min 09 s** after the load stopped, as configured (15-minute window), and the remaining instance kept serving.
3. **No server-side errors** in 6,419 requests (0 × 5xx, 0 × 4xx). All 74 client failures are explained by the test laptop's connectivity.
4. **Large headroom**: at the highest load, EC2 CPU ≤ 2 %, RDS CPU ≤ 7.1 %, ≤ 6 DB connections, server-side p50 ≈ 3 ms. The request-count policy, not resource pressure, drove scaling, which suits a demo but would be tuned upwards for production.
5. **Correctness after load**: checkout, stock update and idempotent replay (no double deduction) all behaved correctly, with no application errors.

## Files

| File | Content |
|---|---|
| [`loadtest/phase6-load.js`](../loadtest/phase6-load.js) | k6 script (3 scenarios, per-scenario thresholds, fail-fast on missing URL) |
| [`loadtest/watch-scaling.sh`](../loadtest/watch-scaling.sh) | ASG / target / CloudWatch watcher |
| [`results/phase6-k6-summary.json`](../loadtest/results/phase6-k6-summary.json) | k6 summary (overall and per scenario) |
| [`results/phase6-k6-console.txt`](../loadtest/results/phase6-k6-console.txt) | k6 console output incl. the 74 failure lines |
| [`results/phase6-timeline.txt`](../loadtest/results/phase6-timeline.txt) | scaling timeline samples |
| [`results/phase6-cloudwatch-minutes.txt`](../loadtest/results/phase6-cloudwatch-minutes.txt) | per-minute ALB / EC2 / RDS metrics |
| [`results/phase6-trickle.txt`](../loadtest/results/phase6-trickle.txt) | scale-in trickle log |
| [`results/phase6-app-validation.txt`](../loadtest/results/phase6-app-validation.txt) | post-load application validation |
| [`results/phase6-run-info.txt`](../loadtest/results/phase6-run-info.txt) | run start/end times and k6 exit code (99 = threshold failed, caused by the client outage) |
