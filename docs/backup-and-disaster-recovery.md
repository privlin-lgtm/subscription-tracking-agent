# Backup and Disaster Recovery

*Written per the decision in this conversation, following up on [Phase 11's](phase11-pre-release-audit.md) finding that no backup/restore procedure existed. Database is self-managed Postgres (not a managed service with its own backup story) — backups here are shipped to S3-compatible object storage on a daily schedule.*

## What this covers

`scripts/backup-db.sh` dumps the whole database with `pg_dump --format=custom` (a compressed, `pg_restore`-only binary format — smaller and faster to restore than plain SQL, and supports selective/parallel restore if ever needed) and uploads it to an S3-compatible bucket. `scripts/restore-db.sh` reverses that.

**This is application code and scripts, not a live deployment.** There is no production environment configured yet ([Phase 11](phase11-pre-release-audit.md)) — these scripts are ready to run once one exists, but nothing here has been scheduled against a real server or a real bucket, because neither exists yet in this session.

## Recovery objectives

- **RPO (Recovery Point Objective): 24 hours.** Backups run daily; in the worst case (disaster strikes right before the next scheduled backup) you lose up to a day of data. If that's not acceptable once real usage numbers exist, shorten the cron interval — the script itself doesn't assume daily, that's just the schedule below.
- **RTO (Recovery Time Objective): not yet measured.** It depends on database size (nothing to measure against yet, at zero production users) and the target host's provisioning time. Once there's a real backup file, **time an actual restore** (see "Testing a restore," below) rather than estimating one.

## Setup

1. Create an S3 bucket (AWS S3, or any S3-compatible provider — Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO, etc. all work via the same `aws s3` CLI with `--endpoint-url`).
2. Set a **bucket lifecycle policy** for long-term retention/expiration (e.g., expire objects older than 90 days) — this repo's scripts don't manage bucket-side retention; that's the bucket's own lifecycle rule, configured once in your provider's console/CLI.
3. Install the `aws` CLI (or a compatible tool that speaks the same commands) on whatever host runs the backup — it isn't a Node/npm dependency, it's an OS-level prerequisite.
4. Set environment variables on the backup host:

```bash
DATABASE_URL="postgresql://..."          # already required by the app
BACKUP_S3_BUCKET="your-bucket-name"      # required, no s3:// prefix
BACKUP_S3_ENDPOINT_URL=""                # only for non-AWS S3-compatible providers; leave unset for real AWS S3
BACKUP_S3_PREFIX="subscription-tracker"  # optional, default shown
BACKUP_DIR="./backups"                   # optional, local staging directory
BACKUP_LOCAL_RETENTION_DAYS="3"          # optional, local copies only — the bucket is the long-term store
```

Also set standard AWS credential env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`) or an AWS CLI profile with write access scoped to just that bucket — not a full-account key.

## Schedule

Run as an OS-level cron job, independent of the Node app's own process — a backup shouldn't depend on the application being healthy in order to protect itself:

```cron
# Daily at 03:00 UTC
0 3 * * * /path/to/scripts/backup-db.sh >> /var/log/subscription-tracker-backup.log 2>&1
```

Deliberately **not** wired into `node-cron`/`worker.ts`: if the app process is down or crash-looping, that's exactly when you most need a backup to still run.

The script exits non-zero on any failure (empty/undersized dump, upload failure). Whatever runs it should surface that failure to a human — cron's own mail-on-error, a `systemd` unit with `OnFailure=`, or piping the exit code into the monitoring/alerting setup once that exists.

## Testing a restore

A backup that's never been restored is a hope, not a plan. Before relying on this in production:

1. Point `DATABASE_URL` at a scratch database (not production).
2. Run `scripts/restore-db.sh s3://<bucket>/subscription-tracker/<a-real-backup-file>.dump`.
3. Confirm the app actually works against the restored copy (log in, see subscription data).
4. Note how long steps 2–3 took — that's your real RTO, not an estimate.

Repeat this periodically (e.g., quarterly), not just once — restore procedures rot silently when nobody exercises them.

## What's explicitly out of scope here

- **Point-in-time recovery** (continuous WAL archiving for sub-24-hour RPO) — not built; daily `pg_dump` was the agreed target. If RPO needs to tighten later, that's a different mechanism (WAL-G, pgBackRest, or a managed provider's built-in PITR), not an extension of this script.
- **Bucket provisioning, IAM policy, and lifecycle configuration** — these happen in your cloud provider's console/CLI, not in this repository.
- **Backing up anything other than Postgres** — there's no other persistent state in this application (no file storage, no separate cache store) as of this writing.
