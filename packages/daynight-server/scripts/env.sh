#!/usr/bin/env bash

DAYNIGHT_MODULE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export GOCACHE="$DAYNIGHT_MODULE_ROOT/.tmp/go-cache"
export GOMODCACHE="$DAYNIGHT_MODULE_ROOT/.tmp/go-mod"
export GOPATH="$DAYNIGHT_MODULE_ROOT/.tmp/go"
export GOBIN="$DAYNIGHT_MODULE_ROOT/.tmp/bin"
export TMPDIR="$DAYNIGHT_MODULE_ROOT/.tmp/tmp"
export XDG_CONFIG_HOME="$DAYNIGHT_MODULE_ROOT/.tmp/config"
export XDG_CACHE_HOME="$DAYNIGHT_MODULE_ROOT/.tmp/cache"
export GOENV=off
export GOTOOLCHAIN=go1.27.2
mkdir -p -- "$GOCACHE" "$GOMODCACHE" "$GOPATH" "$GOBIN" "$TMPDIR" \
  "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
