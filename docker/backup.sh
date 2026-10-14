#!/bin/sh
# Daily database backup: a compressed pg_dump in /backups, the last $KEEP_DAYS days kept.
# Runs in the `backup` service of docker-compose.prod.yml. Restore with:
#   pg_restore --clean --no-owner -d "$DATABASE_URL" /backups/affiliate-YYYY-MM-DD.dump
set -eu
KEEP_DAYS="${KEEP_DAYS:-14}"
while true; do
  file="/backups/affiliate-$(date -u +%Y-%m-%d).dump"
  if pg_dump --format=custom --no-owner --file="$file.tmp" "$DATABASE_URL"; then
    mv "$file.tmp" "$file"
    echo "backup written: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "backup FAILED" >&2
  fi
  find /backups -name 'affiliate-*.dump' -mtime +"$KEEP_DAYS" -delete
  sleep 86400
done
