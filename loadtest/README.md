# Load tests (k6)

Scripts run through Docker, so nothing needs installing. Run them from the repository root in PowerShell or Git Bash.

| Script | Purpose | Used in |
|---|---|---|
| `scaleout-ramp.js` | Read-only ramp: ~3 req/s for 3 min (≈180 req/target/min), then ~7 req/s (≈420 req/target/min) for up to 10 min. Pushes the ASG across the 300 req/target/min scale-out threshold. Creates no orders. | Phase 4 Auto Scaling test (docs/07) |

## Run

```bash
# Git Bash (MSYS_NO_PATHCONV stops Git Bash rewriting the container path)
MSYS_NO_PATHCONV=1 docker run --rm --name cc-k6 -m 300m \
  -e BASE_URL=http://<alb-dns-name> \
  -v "$(pwd -W)/loadtest:/scripts" \
  grafana/k6 run --summary-export /scripts/k6-summary.json /scripts/scaleout-ramp.js
```

`BASE_URL` is the `app_url` output of `infra/envs/dev` (`terraform output -raw app_url`).

Stop early with `docker stop cc-k6` once scale-out is confirmed. k6 still writes its summary.

## Notes
- **Cost.** One run sends about 4,000–6,000 small GET requests, which costs a fraction of a cent in ALB LCUs and CloudWatch Logs.
- **Client-side errors.** k6 counts DNS or connection errors on the test machine as failed requests. Compare them with the ALB's `HTTPCode_ELB_5XX_Count` and `HTTPCode_Target_5XX_Count` before blaming the application (see docs/07 §7).
- **Scale-in needs some traffic.** With zero requests the ALB publishes no `RequestCountPerTarget` datapoints, and the scale-in alarm cannot evaluate. Keep a trickle of ~6 req/min running after the ramp, e.g.:
  ```bash
  while true; do curl -s -o /dev/null "$BASE_URL/api/products?limit=5"; sleep 10; done
  ```
