#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 2 ]]; then
  printf '%s\n' 'Usage: use-ubuntu-archives.sh <ubuntu-sources-file> <mirror-list-file>' >&2
  exit 1
fi

sources_file="$1"
mirror_file="$2"
if ! awk -v mirror="mirror+file:$mirror_file" \
  '$1 == "URIs:" && $2 == mirror && NF == 2 { found = 1 } END { exit !found }' "$sources_file"; then
  printf 'Ubuntu sources do not reference the expected mirror list: %s\n' "$mirror_file" >&2
  exit 1
fi
if [[ ! -f "$mirror_file" ]]; then
  printf 'Ubuntu mirror list is not a regular file: %s\n' "$mirror_file" >&2
  exit 1
fi

if ! mirror_list="$(awk '
  {
    uri = $1
    sub(/\/$/, "", uri)
    if (uri == "http://azure.archive.ubuntu.com/ubuntu" || uri == "https://azure.archive.ubuntu.com/ubuntu") next
    if (uri == "https://archive.ubuntu.com/ubuntu") archive = 1
    if (uri == "https://security.ubuntu.com/ubuntu") security = 1
    print
  }
  END { exit !(archive && security) }
' "$mirror_file")"; then
  printf '%s\n' 'Ubuntu mirror list must include the official HTTPS archive and security services.' >&2
  exit 1
fi
printf '%s\n' "$mirror_list" | tee "$mirror_file"
