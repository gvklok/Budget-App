#!/usr/bin/env bash
# Polls origin/main; if it moved, pulls and rebuilds. Run from cron every few
# minutes. Safe to run repeatedly — it's a no-op whenever main hasn't moved.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="main"

git fetch origin "$BRANCH" --quiet

LOCAL=$(git rev-parse "$BRANCH")
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') deploying $LOCAL -> $REMOTE"
git checkout "$BRANCH"
git pull origin "$BRANCH"
docker compose up --build -d
echo "$(date '+%Y-%m-%d %H:%M:%S') deploy ok, now at $(git rev-parse "$BRANCH")"
