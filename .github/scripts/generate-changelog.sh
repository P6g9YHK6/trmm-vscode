#!/usr/bin/env bash
set -euo pipefail

VERSION="$1"
PREV_TAG=$(git tag --sort=-creatordate | head -1 || true)

echo "Generating changelog for $VERSION"
echo "Previous tag: ${PREV_TAG:-none}"

if [ -n "$PREV_TAG" ]; then
  COMMIT_COUNT=$(git log --oneline --no-merges "$PREV_TAG"..HEAD | wc -l)
  echo "Commits since $PREV_TAG: $COMMIT_COUNT"

  CHANGES=$(
    git log --no-merges "$PREV_TAG"..HEAD \
      --format="%s%n%B" \
      | grep -v '^Version .*\[skip ci\]$' \
      | grep -v '^\[skip ci\]' \
      | awk '!seen[$0]++' \
      | sed '/^$/d' \
      | sed 's/^/- /'
  )

  ENTRY_COUNT=$(echo "$CHANGES" | grep -c . || true)
  echo "Changelog entries: $ENTRY_COUNT"
else
  CHANGES="Initial release"
  echo "No previous tag — initial release"
fi

ENTRY="## $VERSION
$(date +%Y-%m-%d)

$CHANGES
"

echo "$ENTRY" > /tmp/new_changelog.md
if [ -f CHANGELOG.md ]; then
  tail -n +2 CHANGELOG.md >> /tmp/new_changelog.md
fi
cp /tmp/new_changelog.md CHANGELOG.md
echo "Changelog written to CHANGELOG.md"
