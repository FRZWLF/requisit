#!/usr/bin/env bash
# Creates or updates the repo's labels from labels.txt. Idempotent. Needs gh.
set -euo pipefail
repo=${1:-FRZWLF/requisit}
while IFS='|' read -r name color desc; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  gh label create "$name" -R "$repo" --color "$color" --description "$desc" --force >/dev/null && echo "label $name"
done < "$(dirname "$0")/labels.txt"
