#!/usr/bin/env bash
#
# Restore a database backup produced by backup-db.sh, per docs/backup-and-disaster-recovery.md.
# Destructive: restores into DATABASE_URL, which is expected to already exist and be reachable
# (create an empty database first if this is a fresh host). Requires explicit confirmation
# unless --yes is passed (for scripted/CI restore drills).
#
# Usage:
#   scripts/restore-db.sh s3://my-bucket/subscription-tracker/subscription_tracker_20260901T030000Z.dump
#   scripts/restore-db.sh ./backups/subscription_tracker_20260901T030000Z.dump
#   scripts/restore-db.sh <path-or-s3-uri> --yes    # skip the confirmation prompt

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

SOURCE="${1:?Usage: restore-db.sh <local-path-or-s3-uri> [--yes]}"
AUTO_YES="${2:-}"

WORKDIR=""
cleanup() {
  [ -n "$WORKDIR" ] && rm -rf "$WORKDIR"
}
trap cleanup EXIT

if [[ "$SOURCE" == s3://* ]]; then
  WORKDIR="$(mktemp -d)"
  DUMP_FILE="$WORKDIR/restore.dump"
  S3_ARGS=()
  if [ -n "${BACKUP_S3_ENDPOINT_URL:-}" ]; then
    S3_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT_URL")
  fi
  echo "[restore-db] Downloading $SOURCE ..."
  aws s3 cp "${S3_ARGS[@]}" "$SOURCE" "$DUMP_FILE"
else
  DUMP_FILE="$SOURCE"
  if [ ! -f "$DUMP_FILE" ]; then
    echo "[restore-db] ERROR: $DUMP_FILE not found." >&2
    exit 1
  fi
fi

if [ "$AUTO_YES" != "--yes" ]; then
  echo "This will restore $SOURCE into the database at:"
  echo "  ${DATABASE_URL%%@*}@***  (host/credentials redacted for display)"
  echo "This does NOT drop existing tables first -- pg_restore will fail loudly on conflicting"
  echo "objects rather than silently overwrite them. For a real disaster-recovery restore onto a"
  echo "fresh/empty database, that's what you want. Continue? [y/N]"
  read -r CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "[restore-db] Aborted."
    exit 1
  fi
fi

echo "[restore-db] Restoring $DUMP_FILE ..."
pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" "$DUMP_FILE"

echo "[restore-db] Done."
