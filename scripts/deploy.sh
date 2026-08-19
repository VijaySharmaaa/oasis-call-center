#!/usr/bin/env bash
#
# Deploy the stack on the EC2 host.
#
# Always brings containers up through compose. That is the whole point: a
# container created by hand with `docker run` lands on its own network, nginx
# can no longer resolve `backend`, and every proxied request — including every
# BuzzDial webhook — becomes a 502 that the backend never sees and never logs.
# That failure ran from roughly 10 June to 19 August 2026 and cost about 2,200
# calls. See the header of docker-compose.deploy.yml.
#
# Usage, from the directory holding docker-compose.deploy.yml:
#   ./scripts/deploy.sh              # pull :dev1 and restart everything
#   ./scripts/deploy.sh backend      # one service only
#
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.deploy.yml}"
REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
REGISTRY="${ECR_REGISTRY:-970776445824.dkr.ecr.ap-south-1.amazonaws.com}"
SERVICE="${1:-}"

cd "$(dirname "$0")/.."

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "error: $COMPOSE_FILE not found in $(pwd)" >&2
  exit 1
fi

echo "==> Authenticating to ECR"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

echo "==> Pulling images"
docker compose -f "$COMPOSE_FILE" pull ${SERVICE:+"$SERVICE"}

echo "==> Starting containers"
# --remove-orphans clears anything left behind by a previous hand-run container,
# which is what put the frontend on its own network in the first place.
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans ${SERVICE:+"$SERVICE"}

echo "==> Waiting for health"
for _ in $(seq 1 30); do
  unhealthy=$(docker ps --filter "health=unhealthy" --format '{{.Names}}' || true)
  starting=$(docker ps --filter "health=starting" --format '{{.Names}}' || true)
  [[ -z "$starting" ]] && break
  sleep 2
done

echo
docker compose -f "$COMPOSE_FILE" ps

# The check that matters: can nginx actually reach the backend? A 200 here means
# the proxy path BuzzDial depends on is open. Anything else means the webhook is
# being 502'd, whatever the containers claim about being "up".
echo
echo "==> Verifying the proxy path"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:8080/health || echo "000")
if [[ "$code" == "200" ]]; then
  echo "    OK — nginx reaches the backend (HTTP $code)"
else
  echo "    FAILED — nginx cannot reach the backend (HTTP $code)" >&2
  echo "    Webhook deliveries will be rejected. Check that every container is" >&2
  echo "    on the same network:  docker network inspect \$(basename \$(pwd))_oasis" >&2
  exit 1
fi
