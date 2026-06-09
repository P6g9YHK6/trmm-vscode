#!/usr/bin/env bash
set -euo pipefail

CURRENT_VERSION="$1"
NOISE_PATTERN='\[skip ci\]'
USER_PATHS='src/ package.json'

log() { echo "$*" >&2; }

log "Current version: $CURRENT_VERSION"

# Find the latest tag to use as a starting point
LATEST_TAG=$(git tag --sort=-version:refname 2>/dev/null | head -1)

if [ -n "$LATEST_TAG" ]; then
  COMMITS=$(git log --no-merges "$LATEST_TAG..HEAD" --format="%s" -- $USER_PATHS 2>/dev/null || true)
else
  COMMITS=$(git log --no-merges --format="%s" -- $USER_PATHS 2>/dev/null || true)
fi

if [ -z "$COMMITS" ]; then
  CHANGES="  *(no user-facing changes)*"
else
  CHANGES=$(echo "$COMMITS" | grep -v -E "$NOISE_PATTERN" | awk '!seen[$0]++' | sed 's/^/- /' || true)
  [ -z "$CHANGES" ] && CHANGES="  *(no user-facing changes)*"
fi

{
  echo "# Changelog"
  echo ""
  echo "## $CURRENT_VERSION"
  date +%Y-%m-%d
  echo ""
  echo "$CHANGES"
} > CHANGELOG.md

log "CHANGELOG.md written"
