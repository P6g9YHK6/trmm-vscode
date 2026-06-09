#!/usr/bin/env bash
set -euo pipefail

CURRENT_VERSION="$1"
NOISE_PATTERN='\[skip ci\]'
USER_PATHS='src/ package.json'

log() { echo "$*" >&2; }
log "Current version: $CURRENT_VERSION"

# Collect all version tags in ascending order
TAGS=()
while IFS= read -r tag; do
  TAGS+=("$tag")
done < <(git tag --sort=version:refname 2>/dev/null)

log "Tags: ${#TAGS[@]} found"

# Get all user-facing commits (hash + timestamp + subject), dedup by subject
# Format: HASH TS SUBJECT (space-separated, subject is rest after first 2 fields)
RAW=$(git log --no-merges --format="%H %ct %s" -- $USER_PATHS 2>/dev/null || true)

declare -A COMMIT_MSG    # message -> hash
declare -A COMMIT_TS     # message -> timestamp
declare -A COMMIT_VER    # message -> version string

while IFS=' ' read -r hash ts rest; do
  [ -z "$hash" ] && continue
  [[ "$hash" =~ ^[0-9a-f]{40}$ ]] || continue
  msg="${rest#"${rest%%[! ]*}"}"

  # Filter noise
  if echo "$msg" | grep -q -E "$NOISE_PATTERN"; then
    continue
  fi

  # Dedup by message: keep first (newest) occurrence
  if [ -n "${COMMIT_MSG[$msg]:-}" ]; then
    continue
  fi
  COMMIT_MSG["$msg"]="$hash"
  COMMIT_TS["$msg"]="$ts"
done <<< "$RAW"

# Assign each deduped commit to the earliest version tag containing it
total=${#COMMIT_MSG[@]}
count=0
for msg in "${!COMMIT_MSG[@]}"; do
  hash="${COMMIT_MSG[$msg]}"
  tag=$(git tag --contains "$hash" --sort=version:refname 2>/dev/null | head -1 || true)
  if [ -n "$tag" ]; then
    COMMIT_VER["$msg"]="${tag#v}"
  else
    COMMIT_VER["$msg"]="$CURRENT_VERSION"
  fi
  count=$((count + 1))
done
log "Assigned $count commits to versions"

# Collect all version names (newest first)
ALL_VERSIONS=("$CURRENT_VERSION")
declare -A VERSION_SEEN
VERSION_SEEN["$CURRENT_VERSION"]=1
for ((idx=${#TAGS[@]}-1; idx>=0; idx--)); do
  ver="${TAGS[$idx]#v}"
  if [ -z "${VERSION_SEEN[$ver]:-}" ]; then
    ALL_VERSIONS+=("$ver")
    VERSION_SEEN["$ver"]=1
  fi
done

# Build changelog (newest version first)
echo "# Changelog" > CHANGELOG.md

for ver in "${ALL_VERSIONS[@]}"; do
  # Collect commits for this version, sorted by timestamp ascending (oldest first)
  ver_msgs=()
  for msg in "${!COMMIT_VER[@]}"; do
    if [ "${COMMIT_VER[$msg]}" = "$ver" ]; then
      ver_msgs+=("${COMMIT_TS[$msg]}|$msg")
    fi
  done

  # Sort by timestamp
  IFS=$'\n' ver_msgs=($(printf '%s\n' "${ver_msgs[@]}" | sort -t'|' -k1 -n))
  unset IFS

  # Date: use tag commit date, or today for current version
  tag_date=$(git log -1 --format=%as "v$ver" 2>/dev/null || echo "$(date +%Y-%m-%d)")

  {
    echo ""
    echo "## $ver"
    echo "$tag_date"
    echo ""
    if [ ${#ver_msgs[@]} -eq 0 ]; then
      echo "No user-facing changes."
    else
      for entry in "${ver_msgs[@]}"; do
        echo "- ${entry#*|}"
      done
    fi
  } >> CHANGELOG.md
done

log "CHANGELOG.md written ($(wc -l < CHANGELOG.md) lines)"
