#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f $deployment_dir/.env ]]; then
  printf '%s\n' 'Configure deployment/localhost/.env using .env.example before starting the stack.' >&2
  exit 2
fi
exec docker compose --env-file "$deployment_dir/.env" --project-directory "$deployment_dir" \
  --file "$deployment_dir/compose.yaml" \
  up --build --force-recreate --detach --wait --wait-timeout 120
