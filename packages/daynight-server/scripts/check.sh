#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
cd -- "$DAYNIGHT_MODULE_ROOT"
: "${DAYNIGHT_TEST_DATABASE_URL:?Set DAYNIGHT_TEST_DATABASE_URL to the required PostgreSQL test database}"

# Both local and CI runs use the checked-in coverage rules.
unset COVERPROFILE MODULE_PREFIX PROJECT_NAME HTML_OUT THRESHOLD_FUNC \
  THRESHOLD_PACKAGE THRESHOLD_PRINT THRESHOLD_TOTAL UNCOVERED_LIMIT \
  EXCLUDE_PACKAGES SKIP_RESULT_PACKAGES EXCLUDE_FILES EXCLUDE_FUNCS \
  EXCLUDE_FUNC_SUFFIXES TEST_TIMEOUT BUILD_TAGS GENERATE_HTML \
  RACE_DETECTION FAIL_ON_CRITICAL_BLOCKS

node --test scripts/coverage.test.mts
go build -o .tmp/daynight-server ./cmd/daynight-server
go vet ./...
go run github.com/codetreker/go-cov/cmd/go-cov@d6caf2759e330b48d69a543695e37002a48feb1d \
  --config .go-cov.toml --ci --coverprofile .tmp/coverage.out
node scripts/coverage.mts .tmp/coverage.out
