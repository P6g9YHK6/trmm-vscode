#!/usr/bin/env bash
set -euo pipefail

PREV_TAG=$(git tag --sort=-creatordate | head -1 || true)

if [ -n "$PREV_TAG" ]; then
  CHANGES=$(
    git log --no-merges "$PREV_TAG"..HEAD \
      --format="%s%n%B" \
      | grep -v '^Version .*\[skip ci\]$' \
      | grep -v '^\[skip ci\]' \
      | awk '!seen[$0]++' \
      | sed '/^$/d' \
      | sed 's/^/- /'
  )
else
  CHANGES="Initial release"
fi

ENTRY="## $1
$(date +%Y-%m-%d)

$CHANGES
"

echo "$ENTRY" > /tmp/new_changelog.md
if [ -f CHANGELOG.md ]; then
  tail -n +2 CHANGELOG.md >> /tmp/new_changelog.md
fi
cp /tmp/new_changelog.md CHANGELOG.md
