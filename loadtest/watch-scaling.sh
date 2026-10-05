#!/usr/bin/env bash
# Prints one line every 30 s while a load test runs: ASG desired / instances,
# target health, and the latest complete 1-minute CloudWatch datapoints for
# ALB requests, requests per target, 5xx, EC2 CPU and RDS CPU / connections.
# Dimensions come from `terraform output cloudwatch_dimensions` (infra/envs/dev).
# Usage: loadtest/watch-scaling.sh >> loadtest/results/<run>-timeline.txt
set -uo pipefail
export AWS_PROFILE="${AWS_PROFILE:-cc-project}" AWS_REGION="${AWS_REGION:-ap-southeast-2}" MSYS_NO_PATHCONV=1
nocr() { tr -d '\r'; }

ROOT=$(git rev-parse --show-toplevel)
DIMS=$(terraform -chdir="$ROOT/infra/envs/dev" output -json cloudwatch_dimensions | nocr)
dim() { printf '%s' "$DIMS" | python -c "import json,sys; print(json.load(sys.stdin)['$1'])" | nocr; }
LB=$(dim LoadBalancer); TG=$(dim TargetGroup); ASG=$(dim AutoScalingGroupName); DB=$(dim DBInstanceIdentifier)
TG_ARN=$(aws elbv2 describe-target-groups --names "${ASG%-asg}-tg" --query 'TargetGroups[0].TargetGroupArn' --output text | nocr)

# Latest complete minute (the current minute is still filling up).
metric() { # namespace name stat dimension...
  local ns=$1 name=$2 stat=$3; shift 3
  aws cloudwatch get-metric-statistics --namespace "$ns" --metric-name "$name" --dimensions "$@" \
    --start-time "$(date -u -d '-4 min' +%FT%TZ)" --end-time "$(date -u -d '-1 min' +%FT%TZ)" --period 60 \
    --statistics "$stat" --query "sort_by(Datapoints,&Timestamp)[-1].$stat" --output text 2>/dev/null | nocr
}

echo "time desired instances targets alb_req/min req/target/min alb5xx+tgt5xx ec2_cpu_avg rds_cpu rds_conn"
while true; do
  asg=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG" \
    --query 'AutoScalingGroups[0].[DesiredCapacity, join(`,`, Instances[].join(`:`,[InstanceId,LifecycleState]))]' --output text 2>/dev/null | nocr | tr '\t' ' ')
  th=$(aws elbv2 describe-target-health --target-group-arn "$TG_ARN" \
    --query 'join(`,`, TargetHealthDescriptions[].join(`:`,[Target.Id,TargetHealth.State]))' --output text 2>/dev/null | nocr)
  req=$(metric AWS/ApplicationELB RequestCount Sum Name=LoadBalancer,Value="$LB")
  rpt=$(metric AWS/ApplicationELB RequestCountPerTarget Sum Name=LoadBalancer,Value="$LB" Name=TargetGroup,Value="$TG")
  e5=$(metric AWS/ApplicationELB HTTPCode_ELB_5XX_Count Sum Name=LoadBalancer,Value="$LB")
  t5=$(metric AWS/ApplicationELB HTTPCode_Target_5XX_Count Sum Name=LoadBalancer,Value="$LB")
  cpu=$(metric AWS/EC2 CPUUtilization Average Name=AutoScalingGroupName,Value="$ASG")
  rcpu=$(metric AWS/RDS CPUUtilization Average Name=DBInstanceIdentifier,Value="$DB")
  rconn=$(metric AWS/RDS DatabaseConnections Maximum Name=DBInstanceIdentifier,Value="$DB")
  echo "$(date +%H:%M:%S) ${asg%% *} [${asg#* }] [$th] $req $rpt ${e5}+${t5} $cpu $rcpu $rconn"
  sleep 30
done
