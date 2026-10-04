#!/usr/bin/env bash
# Deploy (or roll back) the checkout app image to the dev stack.
# See docs/09-ci-cd.md. Run from the repository root in Git Bash or Linux/macOS:
#
#   scripts/deploy.sh                     # build + push the current commit, then deploy it
#   scripts/deploy.sh --rollback 8bc96ee  # redeploy an image that is already in ECR
#   scripts/deploy.sh --checkout-smoke    # also place one real test order after deploying
#   scripts/deploy.sh --yes               # skip the confirmation prompt
#   scripts/deploy.sh --plan-only         # build/push if needed, plan + guard, apply nothing
#
# Credentials: your own short-lived `aws login` session (profile cc-project).
# No access keys are used or stored anywhere.
#
# What it changes: ONLY infra/envs/dev/terraform.tfvars `image_tag` and, through
# Terraform, the launch template + ASG (which triggers the existing rolling
# instance refresh). It aborts if the plan would touch anything else.

set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-cc-project}"
export AWS_REGION="${AWS_REGION:-ap-southeast-2}"
export MSYS_NO_PATHCONV=1                 # Git Bash: keep /var/run/docker.sock etc. as-is
export GOGC="${GOGC:-20}" GOMEMLIMIT="${GOMEMLIMIT:-700MiB}"  # keep the AWS provider small on low-RAM machines

REPO_NAME=cc-checkout
ROOT=$(git rev-parse --show-toplevel)
TF_DIR="$ROOT/infra/envs/dev"
TFVARS="$TF_DIR/terraform.tfvars"
REFRESH_TIMEOUT_S=1200

TAG="" ROLLBACK=false ASSUME_YES=false CHECKOUT_SMOKE=false PLAN_ONLY=false
while [ $# -gt 0 ]; do
  case "$1" in
    --rollback) ROLLBACK=true; TAG="${2:?--rollback needs an image tag}"; shift 2 ;;
    --yes|-y) ASSUME_YES=true; shift ;;
    --checkout-smoke) CHECKOUT_SMOKE=true; shift ;;
    --plan-only) PLAN_ONLY=true; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mDEPLOY FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

PY=""
for c in python3 python; do "$c" -c 'import sys' >/dev/null 2>&1 && PY=$c && break; done
[ -n "$PY" ] || fail "python is required (used to parse JSON)"
for c in aws terraform docker curl git; do command -v "$c" >/dev/null || fail "$c is not installed"; done

# ---------------------------------------------------------------------------
log "Preflight"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text) || fail "no AWS session: run 'aws login --region $AWS_REGION --profile $AWS_PROFILE'"
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
IMAGE_REPO="$REGISTRY/$REPO_NAME"
[ -f "$TFVARS" ] || fail "$TFVARS not found (copy terraform.tfvars.example)"
CURRENT_TAG=$(sed -nE 's/^image_tag[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$TFVARS")
[ -n "$CURRENT_TAG" ] || fail "no image_tag line in $TFVARS"

if ! $ROLLBACK; then
  [ -z "$(git status --porcelain)" ] || fail "working tree is not clean; commit first so the image tag matches the code"
  TAG=$(git rev-parse --short=7 HEAD)
fi
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || fail "image tag must be a git SHA, got '$TAG'"
echo "AWS account $ACCOUNT, region $AWS_REGION; deployed now: $CURRENT_TAG; deploying: $TAG"

image_in_ecr() {
  aws ecr describe-images --repository-name "$REPO_NAME" --image-ids imageTag="$1" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
if image_in_ecr "$TAG"; then
  log "Image $REPO_NAME:$TAG is already in ECR (tags are immutable): skipping build"
elif $ROLLBACK; then
  fail "rollback image $TAG is not in ECR"
else
  log "Build $IMAGE_REPO:$TAG (linux/amd64)"
  docker build --platform linux/amd64 -f "$ROOT/backend/Dockerfile" \
    --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" -t "$IMAGE_REPO:$TAG" "$ROOT"
  [ "$(docker image inspect "$IMAGE_REPO:$TAG" --format '{{.Config.User}}')" = node ] || fail "image does not run as the non-root node user"

  log "Push to ECR"
  # The registry login happens inside a throwaway docker:cli container, so the
  # short-lived token never touches the host's credential store (Docker
  # Desktop's Windows store rejects ECR tokens) and is never written to disk.
  aws ecr get-login-password | docker run --rm -i -v /var/run/docker.sock:/var/run/docker.sock docker:cli \
    sh -c "docker login --username AWS --password-stdin $REGISTRY >/dev/null && docker push $IMAGE_REPO:$TAG"
  image_in_ecr "$TAG" || fail "push did not reach ECR"
fi

# ---------------------------------------------------------------------------
log "Terraform plan (image_tag $CURRENT_TAG -> $TAG)"
cp "$TFVARS" "$TFVARS.bak"
restore_tfvars() { [ -f "$TFVARS.bak" ] && mv "$TFVARS.bak" "$TFVARS"; }
trap restore_tfvars EXIT    # keep the old tag unless the apply succeeds
sed -i -E "s/^(image_tag[[:space:]]*=[[:space:]]*)\"[^\"]+\"/\1\"$TAG\"/" "$TFVARS"

PLAN=$(mktemp -t deployplan.XXXXXX)
terraform -chdir="$TF_DIR" plan -input=false -no-color -out="$PLAN" >/dev/null
terraform -chdir="$TF_DIR" show -json "$PLAN" > "$PLAN.json"
set +e
"$PY" - "$PLAN.json" <<'PYEOF'
import json, sys
plan = json.load(open(sys.argv[1], encoding="utf-8"))
# The only changes a deployment may make (in-place updates):
allowed = {"aws_launch_template": {"user_data"}, "aws_autoscaling_group": {"launch_template"}}
changes, bad = [], []
for rc in plan["resource_changes"]:
    actions = rc["change"]["actions"]
    if actions == ["no-op"]:
        continue
    before, after = rc["change"]["before"] or {}, rc["change"]["after"] or {}
    changed = sorted(k for k in after if before.get(k) != after.get(k))
    address = rc["address"]
    changes.append(f"  {address}: {actions} {changed}")
    ok = actions == ["update"] and rc["type"] in allowed and set(changed) <= allowed[rc["type"]] | {"default_version", "latest_version"}
    if rc["type"] == "aws_autoscaling_group":
        ok = ok and (before.get("min_size"), before.get("max_size")) == (after.get("min_size"), after.get("max_size"))
    if not ok:
        bad.append(address)
print("\n".join(changes) or "  no changes")
if bad:
    print("REFUSING: the plan changes more than the application image: " + ", ".join(bad))
    sys.exit(3)
sys.exit(0 if changes else 4)
PYEOF
guard=$?
set -e
rm -f "$PLAN.json"
case $guard in
  0) ;;
  4) echo "Image $TAG is already deployed. Nothing to do."; exit 0 ;;
  *) fail "unexpected plan; nothing was applied" ;;
esac

if $PLAN_ONLY; then
  log "Plan only: guard passed, nothing applied (terraform.tfvars restored)"
  exit 0
fi

if ! $ASSUME_YES; then
  read -r -p "Apply this deployment (rolling instance refresh)? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || fail "cancelled by operator"
fi

# ---------------------------------------------------------------------------
log "Apply"
START=$(date +%s)
terraform -chdir="$TF_DIR" apply -input=false -no-color "$PLAN" | grep -E "Modifications complete|Apply complete"
rm -f "$PLAN" "$TFVARS.bak"   # applied: keep the new tag in terraform.tfvars
trap - EXIT

ASG=$(terraform -chdir="$TF_DIR" output -raw asg_name)
URL=$(terraform -chdir="$TF_DIR" output -raw app_url)

log "Waiting for the rolling instance refresh"
while :; do
  status=$(aws autoscaling describe-instance-refreshes --auto-scaling-group-name "$ASG" --max-records 1 \
    --query 'InstanceRefreshes[0].[Status,PercentageComplete]' --output text)
  echo "  $(date +%H:%M:%S) $status"
  case "${status%%[[:space:]]*}" in
    Successful) break ;;
    Failed|Cancelled|RollbackSuccessful|RollbackFailed) fail "instance refresh ended with: $status" ;;
  esac
  [ $(( $(date +%s) - START )) -lt $REFRESH_TIMEOUT_S ] || fail "instance refresh still running after $REFRESH_TIMEOUT_S s"
  sleep 15
done

# ---------------------------------------------------------------------------
log "Verify the new version behind the ALB"
TG_ARN=$(aws elbv2 describe-target-groups --names "$(echo "$ASG" | sed 's/-asg$//')-tg" --query 'TargetGroups[0].TargetGroupArn' --output text)
for i in $(seq 1 40); do
  states=$(aws elbv2 describe-target-health --target-group-arn "$TG_ARN" --query 'TargetHealthDescriptions[].TargetHealth.State' --output text)
  versions=$(for _ in 1 2 3 4 5 6; do curl -fsS -m 5 "$URL/api/instance" | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || echo error; done | sort -u | tr '\n' ' ')
  echo "  targets: [$states]  versions served: [$versions]"
  # every target exactly "healthy" ("unhealthy" must not match) and only the new version answering
  if [ -n "$states" ] && ! tr '\t' '\n' <<<"$states" | grep -qvx healthy && [ "$versions" = "$TAG " ]; then break; fi
  [ "$i" -lt 40 ] || fail "new version $TAG is not the only healthy version behind the ALB"
  sleep 10
done

curl -fsS -m 10 "$URL/api/health" >/dev/null || fail "/api/health failed"
ready=$(curl -fsS -m 10 "$URL/api/health/ready") || fail "/api/health/ready failed"
grep -q '"database":"ok"' <<<"$ready" || fail "readiness does not report the database as ok: $ready"
curl -fsS -m 10 -o /dev/null "$URL/api/products?limit=1" || fail "/api/products failed"
curl -fsS -m 10 -o /dev/null "$URL/" || fail "SPA did not load"
echo "  /api/health ok, /api/health/ready database ok, products and SPA ok"

if $CHECKOUT_SMOKE; then
  log "Checkout smoke test (creates one real order: 1 unit of product 1)"
  "$PY" - "$URL" <<'PYEOF'
import json, sys, uuid, urllib.request
url = sys.argv[1]
def call(path, method="GET", body=None, key=None):
    headers = {"Content-Type": "application/json"}
    if key: headers["Idempotency-Key"] = key
    req = urllib.request.Request(url + path, method=method, headers=headers, data=json.dumps(body).encode() if body else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get("Idempotent-Replayed"), json.loads(r.read())
body = {"customer": {"name": "Deploy smoke test", "email": "smoke@example.com"},
        "items": [{"productId": 1, "quantity": 1}],
        "payment": {"cardNumber": "4242 4242 4242 4242", "expiry": "12/30", "cvc": "123"}}
key = str(uuid.uuid4())
s1, r1, o1 = call("/api/orders", "POST", body, key)
s2, r2, o2 = call("/api/orders", "POST", body, key)
assert s1 == 201 and o1["status"] == "PAID", (s1, o1.get("status"))
assert s2 == 200 and r2 == "true" and o2["id"] == o1["id"], (s2, r2)
print(f"  checkout 201 PAID {o1['id']}; idempotent replay 200 (same order)")
PYEOF
fi

# ---------------------------------------------------------------------------
log "Drift check"
set +e
terraform -chdir="$TF_DIR" plan -input=false -no-color -detailed-exitcode >/dev/null
drift=$?
set -e
[ $drift -eq 0 ] || fail "terraform plan is not clean after the deployment (exit $drift)"

log "Deployed $REPO_NAME:$TAG in $(( $(date +%s) - START )) s (previous: $CURRENT_TAG)"
echo "Roll back with: scripts/deploy.sh --rollback $CURRENT_TAG"
