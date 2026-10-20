#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec docker compose --project-directory "$deployment_dir" \
  --file "$deployment_dir/compose.yaml" \
  up --build --force-recreate --detach --wait --wait-timeout 120
