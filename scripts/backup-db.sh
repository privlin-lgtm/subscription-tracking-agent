#!/usr/bin/env bash
#
# Daily database backup for a self-managed Postgres instance, per docs/backup-and-disaster-recovery.md.
# Dumps DATABASE_URL with pg_dump (custom format, internally compressed), uploads it to
# S3-compatible object storage, then prunes local copies older than BACKUP_LOCAL_RETENTION_DAYS.
# Long-term retention is expected to live in the bucket's own lifecycle policy, not on this host.
#
# Required:
#   DATABASE_URL        postgresql://... (already required by the app itself)
#   BACKUP_S3_BUCKET     e.g. my-backups-bucket (no s3:// prefix, no trailing slash)
# Optional:
#   BACKUP_S3_ENDPOINT_URL   set for a non-AWS S3-compatible provider (R2, B2, MinIO, Spaces, ...);
#                            leave unset for real AWS S3
#   BACKUP_S3_PREFIX         key prefix inside the bucket, default "subscription-tracker"
#   BACKUP_DIR               local staging directory, default ./backups
#   BACKUP_LOCAL_RETENTION_DAYS  how many days of local copies to keep, default 3
#
# Exit code is non-zero on any failure (dump, upload, or prune) -- wire this into whatever runs
# it (cron + a mail-on-error MTA, systemd OnFailure=, etc.) so a failed backup is never silent.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-subscription-tracker}"
BACKUP_LOCAL_RETENTION_DAYS="${BACKUP_LOCAL_RETENTION_DAYS:-3}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$BACKUP_DIR/subscription_tracker_${TIMESTAMP}.dump"
S3_KEY="${BACKUP_S3_PREFIX}/subscription_tracker_${TIMESTAMP}.dump"

echo "[backup-db] Dumping database to $DUMP_FILE ..."
pg_dump --format=custom --file="$DUMP_FILE" "$DATABASE_URL"

DUMP_BYTES=$(stat -c%s "$DUMP_FILE" 2>/dev/null || stat -f%z "$DUMP_FILE")
if [ "$DUMP_BYTES" -lt 1024 ]; then
  echo "[backup-db] ERROR: dump file is suspiciously small (${DUMP_BYTES} bytes) -- refusing to upload a likely-empty/broken backup." >&2
  exit 1
fi

S3_ARGS=()
if [ -n "${BACKUP_S3_ENDPOINT_URL:-}" ]; then
  S3_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT_URL")
fi

echo "[backup-db] Uploading to s3://${BACKUP_S3_BUCKET}/${S3_KEY} ..."
aws s3 cp "${S3_ARGS[@]}" "$DUMP_FILE" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}"

echo "[backup-db] Pruning local backups older than ${BACKUP_LOCAL_RETENTION_DAYS} days ..."
find "$BACKUP_DIR" -name 'subscription_tracker_*.dump' -type f -mtime "+${BACKUP_LOCAL_RETENTION_DAYS}" -print -delete

echo "[backup-db] Done: ${DUMP_BYTES} bytes, s3://${BACKUP_S3_BUCKET}/${S3_KEY}"
