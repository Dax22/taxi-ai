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
# Do not use --write-recovery-conf: libpq can expose the password resolved
# from a passfile to that option's generated primary_conninfo. Write the
# fixed, nonsecret connection settings ourselves after a successful backup.
# A failed run deliberately leaves evidence; never auto-delete/retry the volume.
gosu postgres pg_basebackup \
  --dbname='host=taxi-db-primary port=5432 user=taxi_replica sslmode=verify-full sslrootcert=/run/taxi-postgres/ca.crt passfile=/run/taxi-postgres/replication.pgpass connect_timeout=10 application_name=taxi_lighthouse_standby' \
  --pgdata="$PGDATA" --wal-method=stream --no-clean \
  --create-slot --slot=taxi_lighthouse_standby --no-password

# Preserve unrelated ALTER SYSTEM settings. Replace only these recovery
# directives, which PostgreSQL writes as one setting per line.
recovery_config="$PGDATA/postgresql.auto.conf"
if [ -f "$recovery_config" ]; then
  awk '!/^[[:space:]]*(primary_conninfo|primary_slot_name)[[:space:]]*=/' "$recovery_config" > "$recovery_config.taxi-new"
else
  : > "$recovery_config.taxi-new"
fi
cat >> "$recovery_config.taxi-new" <<'CONF'
primary_conninfo = 'host=taxi-db-primary port=5432 user=taxi_replica sslmode=verify-full sslrootcert=/run/taxi-postgres/ca.crt passfile=/run/taxi-postgres/replication.pgpass connect_timeout=10 application_name=taxi_lighthouse_standby'
primary_slot_name = 'taxi_lighthouse_standby'
CONF
chmod 600 "$recovery_config.taxi-new"
chown postgres:postgres "$recovery_config.taxi-new"
mv "$recovery_config.taxi-new" "$recovery_config"
touch "$PGDATA/standby.signal"
chmod 600 "$PGDATA/standby.signal"
chown postgres:postgres "$PGDATA/standby.signal"
printf '%s\n' 'Base backup complete; standby recovery uses TLS and a protected password file.'
