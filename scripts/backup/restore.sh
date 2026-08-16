#!/usr/bin/env sh
# Racio PostgreSQL restore.
#
# Usage:
#   DATABASE_URL=postgresql://racio:password@db-host:5432/racio_restored \
#     ./scripts/backup/restore.sh <backup-file>
#
# The target database must exist and be EMPTY. Restore into a fresh database
# and verify before pointing the application at it.
set -eu

BACKUP="${1:?backup file required}"
DB_URL="${DATABASE_URL:?DATABASE_URL is required}"

pg_restore \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --dbname="$DB_URL" \
  "$BACKUP"

echo "Restore complete."
