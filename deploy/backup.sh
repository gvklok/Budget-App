#!/usr/bin/env bash
# Nightly SQLite backup with rotation. Safe against live writes (uses SQLite's
# online .backup, which respects WAL). Run from the repo root via cron.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="data/budget.db"
BACKUP_DIR="backups"
KEEP_DAYS=30

[ -f "$DB" ] || { echo "no database at $DB"; exit 1; }
mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y-%m-%d)
sqlite3 "$DB" ".backup '$BACKUP_DIR/budget-$STAMP.db'"

# Rotate: keep the last $KEEP_DAYS daily backups
find "$BACKUP_DIR" -name 'budget-*.db' -mtime +"$KEEP_DAYS" -delete

echo "backup ok: $BACKUP_DIR/budget-$STAMP.db"
