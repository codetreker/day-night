#!/usr/bin/env bash
set -euo pipefail
# Each background command owns a process group that can outlive its leader.
set -m

runner_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_dir="$(cd -- "$runner_dir/../.." && pwd)"
receipt_root="$repository_dir/.tmp/dev-ci"

usage() {
  printf '%s\n' 'Usage: bash deployment/dev-ci/run.sh <command> [args...]' \
    '       bash deployment/dev-ci/run.sh --cleanup <run-id>' >&2
  exit 2
}

[[ $# -gt 0 ]] || usage
cleanup_only=false
if [[ $1 == --cleanup ]]; then
  [[ $# -eq 2 ]] || usage
  cleanup_only=true
  run_id=$2
else
  printf -v run_id '%s-%s-%05d' "$(date -u +%Y%m%d%H%M%S)" "$$" "$RANDOM"
fi
[[ $run_id =~ ^[0-9]{14}-[0-9]+-[0-9]{5}$ ]] || {
  printf '%s\n' 'Invalid dev-ci run ID; no Docker operations were performed.' >&2
  exit 2
}
project="daynight-dev-ci-$run_id"
[[ $project =~ ^daynight-dev-ci-[0-9]{14}-[0-9]+-[0-9]{5}$ && $project != daynight-localhost ]] || exit 2
receipt_dir="$receipt_root/$run_id"
manifest="$receipt_dir/manifest.json"
if $cleanup_only && [[ ! -f $manifest ]]; then
  printf '%s\n' 'The dev-ci receipt does not exist; no Docker operations were performed.' >&2
  exit 2
fi
if $cleanup_only; then manifest="$receipt_dir/recovery-manifest.json"; fi
image_tag="daynight-dev-ci:$run_id"
export DAYNIGHT_DEV_CI_IMAGE="$image_tag"
compose=(docker compose --env-file /dev/null --project-directory "$runner_dir" \
  --file "$runner_dir/compose.yaml" --project-name "$project")
phase=created
result=running
cleanup_result=pending
image_id=''
base_url=''
container_ids=''
volume_names=''
network_ids=''
active_pid=''
watcher_pid=''
callback_group=''
cleanup_started=false

array_json() {
  local values=$1 value separator=''
  printf '['
  while IFS= read -r value; do
    [[ -n $value ]] || continue
    [[ $value =~ ^[a-zA-Z0-9_.:-]+$ ]] || return 1
    printf '%s"%s"' "$separator" "$value"
    separator=,
  done <<< "$values"
  printf ']'
}

write_manifest() {
  local container_json volume_json network_json
  container_json="$(array_json "$container_ids")"
  volume_json="$(array_json "$volume_names")"
  network_json="$(array_json "$network_ids")"
  printf '{"schemaVersion":1,"runId":"%s","project":"%s","imageTag":"%s","imageId":"%s","containerIds":%s,"volumeNames":%s,"networkIds":%s,"baseUrl":"%s","phase":"%s","result":"%s","cleanupResult":"%s"}\n' \
    "$run_id" "$project" "$image_tag" "$image_id" "$container_json" "$volume_json" \
    "$network_json" "$base_url" "$phase" "$result" "$cleanup_result" > "$manifest.next"
  mv -- "$manifest.next" "$manifest"
  printf '%s\n' "$image_id" > "$receipt_dir/image-id"
  printf '%s\n' "$base_url" > "$receipt_dir/base-url"
  printf '%s\n' "$container_ids" > "$receipt_dir/container-ids"
  printf '%s\n' "$volume_names" > "$receipt_dir/volume-names"
  printf '%s\n' "$network_ids" > "$receipt_dir/network-ids"
}

stop_group() {
  local pid=$1 signal=$2
  [[ $pid =~ ^[0-9]+$ && $pid -gt 1 ]] || return 1
  kill "-$signal" -- "-$pid" 2>/dev/null || true
}

bounded() {
  local seconds=$1 status
  shift
  "$@" &
  active_pid=$!
  (
    sleep "$seconds"
    stop_group "$active_pid" TERM
    sleep 5
    stop_group "$active_pid" KILL
  ) &
  watcher_pid=$!
  if wait "$active_pid"; then status=0; else status=$?; fi
  stop_group "$active_pid" KILL
  stop_group "$watcher_pid" TERM
  wait "$watcher_pid" 2>/dev/null || true
  active_pid=''
  watcher_pid=''
  return "$status"
}

capture() {
  local variable=$1
  shift
  if bounded "$@" > "$receipt_dir/.capture"; then
    printf -v "$variable" '%s' "$(< "$receipt_dir/.capture")"
    rm -f -- "$receipt_dir/.capture"
  else
    local status=$?
    rm -f -- "$receipt_dir/.capture"
    return "$status"
  fi
}

collect_resources() {
  local observed
  if capture observed 10 docker ps --all --quiet --no-trunc --filter "label=com.docker.compose.project=$project"; then
    if [[ -n $observed ]]; then container_ids=$observed; fi
  else return 1; fi
  if capture observed 10 docker volume ls --quiet --filter "label=com.docker.compose.project=$project"; then
    if [[ -n $observed ]]; then volume_names=$observed; fi
  else return 1; fi
  if capture observed 10 docker network ls --quiet --no-trunc --filter "label=com.docker.compose.project=$project"; then
    if [[ -n $observed ]]; then network_ids=$observed; fi
  else return 1; fi
}

cleanup() {
  local status=$? cleanup_status=0 observed='' interrupted_pid=$active_pid interrupted_watcher=$watcher_pid
  $cleanup_started && return
  cleanup_started=true
  trap - EXIT
  trap ':' INT TERM
  set +e
  if [[ -n $callback_group ]]; then interrupted_pid=$callback_group; fi
  if [[ -n $interrupted_watcher ]]; then
    stop_group "$interrupted_watcher" TERM
    wait "$interrupted_watcher" 2>/dev/null
  fi
  if [[ -n $interrupted_pid ]]; then
    stop_group "$interrupted_pid" TERM
    bounded 5 bash -c 'while kill -0 -- "-$1" 2>/dev/null; do sleep 0.1; done' bash "$interrupted_pid"
    stop_group "$interrupted_pid" KILL
    wait "$interrupted_pid" 2>/dev/null
  fi
  if [[ $result == running ]]; then
    if [[ $status -eq 0 ]]; then result=passed; else result=failed; fi
  fi
  phase=cleanup
  collect_resources || cleanup_status=1
  write_manifest || cleanup_status=1
  bounded 10 "${compose[@]}" ps --all > "$receipt_dir/compose-ps.txt" 2>&1 || cleanup_status=1
  bounded 15 "${compose[@]}" logs --no-color --timestamps > "$receipt_dir/compose-logs.txt" 2>&1 || cleanup_status=1
  bounded 60 "${compose[@]}" down --volumes --remove-orphans --timeout 20 || cleanup_status=1
  if capture observed 10 docker ps --all --quiet --filter "label=com.docker.compose.project=$project"; then
    [[ -z $observed ]] || cleanup_status=1
  else cleanup_status=1; fi
  if capture observed 10 docker volume ls --quiet --filter "label=com.docker.compose.project=$project"; then
    [[ -z $observed ]] || cleanup_status=1
  else cleanup_status=1; fi
  if capture observed 10 docker network ls --quiet --filter "label=com.docker.compose.project=$project"; then
    [[ -z $observed ]] || cleanup_status=1
  else cleanup_status=1; fi
  if [[ $cleanup_status -eq 0 ]]; then
    if capture observed 10 docker image ls --quiet --no-trunc "$image_tag"; then
      if [[ -n $observed ]]; then bounded 15 docker image rm "$image_tag" || cleanup_status=1; fi
    else cleanup_status=1; fi
  fi
  if [[ $cleanup_status -eq 0 ]]; then cleanup_result=passed; else cleanup_result=failed; fi
  phase=finished
  write_manifest || cleanup_status=1
  if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then status=1; fi
  printf 'Dev-ci %s: result=%s cleanup=%s receipt=%s\n' "$run_id" "$result" "$cleanup_result" "$manifest"
  exit "$status"
}

on_signal() {
  local status=$1
  result=cancelled
  exit "$status"
}

mkdir -p -- "$receipt_dir"
if $cleanup_only; then
  [[ -f $receipt_dir/image-id ]] && image_id="$(< "$receipt_dir/image-id")"
  [[ -f $receipt_dir/base-url ]] && base_url="$(< "$receipt_dir/base-url")"
  [[ -f $receipt_dir/container-ids ]] && container_ids="$(< "$receipt_dir/container-ids")"
  [[ -f $receipt_dir/volume-names ]] && volume_names="$(< "$receipt_dir/volume-names")"
  [[ -f $receipt_dir/network-ids ]] && network_ids="$(< "$receipt_dir/network-ids")"
  [[ -z $image_id || $image_id =~ ^sha256:[a-f0-9]{64}$ ]] || exit 2
  [[ -z $base_url || $base_url =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || exit 2
  array_json "$container_ids" > /dev/null
  array_json "$volume_names" > /dev/null
  array_json "$network_ids" > /dev/null
fi
trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
write_manifest
printf 'Dev-ci run ID: %s\n' "$run_id"

if $cleanup_only; then
  result=recovered
  exit 0
fi

phase=building
write_manifest
bounded 600 "${compose[@]}" build server
capture image_id 10 docker image inspect --format '{{.Id}}' "$image_tag"
[[ $image_id =~ ^sha256:[a-f0-9]{64}$ ]] || {
  printf '%s\n' 'The dev-ci build did not produce a valid image ID.' >&2
  exit 1
}
phase=starting
write_manifest
bounded 150 "${compose[@]}" up --no-build --detach --wait --wait-timeout 120
collect_resources
capture server_id 10 "${compose[@]}" ps --quiet server
[[ $server_id =~ ^[a-f0-9]{12,64}$ ]] || {
  printf '%s\n' 'The dev-ci server container was not uniquely identified.' >&2
  exit 1
}
capture running_image 10 docker inspect --format '{{.Image}}' "$server_id"
[[ $running_image == "$image_id" ]] || {
  printf '%s\n' 'The running dev-ci server image differs from this run build.' >&2
  exit 1
}
capture endpoint 10 "${compose[@]}" port gateway 80
[[ $endpoint =~ ^127\.0\.0\.1:([0-9]+)$ && ${BASH_REMATCH[1]} -ge 1 && ${BASH_REMATCH[1]} -le 65535 ]] || {
  printf '%s\n' 'The dev-ci gateway did not publish a unique loopback port.' >&2
  exit 1
}
base_url="http://$endpoint"
phase=command
write_manifest
export DAYNIGHT_BASE_URL="$base_url"
export DAYNIGHT_DEV_CI_RUN_ID="$run_id"
printf 'Dev-ci ready: %s\n' "$base_url"
"$@" &
active_pid=$!
callback_group=$active_pid
if wait "$active_pid"; then command_status=0; else command_status=$?; fi
active_pid=''
if [[ $command_status -eq 0 ]]; then result=passed; else result=failed; fi
exit "$command_status"
