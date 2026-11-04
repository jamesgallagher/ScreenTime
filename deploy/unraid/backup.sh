#!/bin/sh
# The backup container's loop (deploy/unraid/docker-compose.yml): once a day at $BACKUP_AT (local time, TZ), a
# compressed custom-format pg_dump to /backups/screentime-<date>.dump, then dumps older than $KEEP_DAYS days go.
# "sh /backup.sh now" makes one dump at once and exits (docs/guides/deploy.md). Restore with pg_restore.
set -u

dump() {
  name="screentime-$(date +%Y-%m-%d-%H%M).dump"
  if pg_dump --format=custom --file="/backups/$name.part" && mv "/backups/$name.part" "/backups/$name"; then
    echo "$(date -Iseconds) backup: $name ($(du -h "/backups/$name" | cut -f1))"
  else
    rm -f "/backups/$name.part"
    echo "$(date -Iseconds) backup FAILED" >&2
    return 1
  fi
  find /backups -name 'screentime-*.dump' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/removed old backup: /'
}

if [ "${1:-}" = "now" ]; then
  dump
  exit $?
fi

echo "$(date -Iseconds) backup: every day at $BACKUP_AT, keeping $KEEP_DAYS days"
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) $BACKUP_AT" +%s)
  [ "$next" -le "$now" ] && next=$(date -d "$(date -d tomorrow +%Y-%m-%d) $BACKUP_AT" +%s)
  sleep $((next - now))
  dump || true
  sleep 60
done
