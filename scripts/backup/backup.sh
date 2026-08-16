#!/usr/bin/env sh
# Racio PostgreSQL backup (custom format).
#
# Usage:
#   DATABASE_URL=postgresql://racio:password@db-host:5432/racio \
#     ./scripts/backup/backup.sh [output-directory]
#
# Notes:
# - The password must never be embedded in this script; provide DATABASE_URL
#   from the host environment or a secrets manager.
# - Custom format supports selective and parallel restore.
# - Backups contain sensitive financial data: store them encrypted
#   (storage-layer encryption), restrict access, and define retention.
set -eu

DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/racio-backup-$TS.dump"

pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$OUT" \
  "$DB_URL"

echo "Backup written to $OUT"
