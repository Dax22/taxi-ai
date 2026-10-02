#!/bin/sh
set -eu
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[ "${TAXI_AI_DB_ROLE:-}" = standby ] || fail 'Bootstrap is permitted only with TAXI_AI_DB_ROLE=standby.'
[ "$(id -u)" = 0 ] || fail 'Bootstrap must initially run as container root.'
: "${PGDATA:=/var/lib/postgresql/data}"
mkdir -p "$PGDATA" /run/taxi-postgres
[ -z "$(find "$PGDATA" -mindepth 1 -maxdepth 1 -print -quit)" ] ||
  fail 'Refusing to overwrite a nonempty database volume. Preserve or replace it manually after investigation.'
password=$(cat /run/secrets/replication_password)
[ "${#password}" -eq 64 ] || fail 'Replication password must contain 64 lowercase hexadecimal characters.'
case "$password" in *[!0-9a-f]*) fail 'Replication password must contain 64 lowercase hexadecimal characters.';; esac
printf 'taxi-db-primary:5432:replication:taxi_replica:%s\n' "$password" > /run/taxi-postgres/replication.pgpass
unset password
cp /run/secrets/replication_ca /run/taxi-postgres/ca.crt
chmod 700 "$PGDATA" /run/taxi-postgres
chmod 600 /run/taxi-postgres/*
chown -R postgres:postgres "$PGDATA" /run/taxi-postgres
# Secrets stay in the passfile, including in generated primary_conninfo.
# A failed run deliberately leaves evidence; never auto-delete/retry the volume.
exec gosu postgres pg_basebackup \
  --dbname='host=taxi-db-primary port=5432 user=taxi_replica sslmode=verify-full sslrootcert=/run/taxi-postgres/ca.crt passfile=/run/taxi-postgres/replication.pgpass connect_timeout=10 application_name=taxi_lighthouse_standby' \
  --pgdata="$PGDATA" --wal-method=stream --write-recovery-conf \
  --create-slot --slot=taxi_lighthouse_standby --no-password
