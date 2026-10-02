#!/bin/sh
set -eu
umask 077

fail() { printf '%s\n' "$1" >&2; exit 1; }
ipv4() {
  printf '%s\n' "$1" | awk -F. 'NF != 4 { exit 1 } { for (i=1;i<=4;i++) if ($i !~ /^[0-9]+$/ || $i+0 > 255) exit 1 }'
}
private_ipv4() {
  ipv4 "$1" && printf '%s\n' "$1" | awk -F. '{ if ($1 == 10 || ($1 == 172 && $2 >= 16 && $2 <= 31) || ($1 == 192 && $2 == 168)) exit 0; exit 1 }'
}
read_password() {
  password=$(cat "$1")
  [ "${#password}" -eq 64 ] || fail 'Database passwords must each be 64 hexadecimal characters.'
  case "$password" in *[!0-9a-f]*) fail 'Database passwords must each be 64 lowercase hexadecimal characters.';; esac
  printf '%s' "$password"
}

[ "$(id -u)" = 0 ] || fail 'The PostgreSQL startup wrapper must initially run as container root.'
case "${TAXI_AI_DB_ROLE:-}" in primary|standby) ;; *) fail 'Set TAXI_AI_DB_ROLE=primary or standby.';; esac
private_ipv4 "${TAXI_AI_PRIVATE_IP:-}" || fail 'Database binding requires this host RFC1918 private IPv4 address.'
private_ipv4 "${TAXI_AI_REPLICATION_PEER_IP:-}" || fail 'Set an exact RFC1918 replication peer IPv4 address.'
[ "$TAXI_AI_PRIVATE_IP" != "$TAXI_AI_REPLICATION_PEER_IP" ] || fail 'Primary and standby must use different private addresses.'
subnet=${TAXI_AI_DOCKER_SUBNET:-172.28.0.0/24}
case "$subnet" in */*) ;; *) fail 'Set an IPv4 Docker CIDR.';; esac
ipv4 "${subnet%/*}" || fail 'Invalid Docker IPv4 network.'
mask=${subnet##*/}
case "$mask" in ''|*[!0-9]*) fail 'Invalid Docker network mask.';; esac
[ "$mask" -ge 8 ] && [ "$mask" -le 30 ] || fail 'Docker network mask must be between 8 and 30.'

: "${PGDATA:=/var/lib/postgresql/data}"
if [ "$TAXI_AI_DB_ROLE" = standby ]; then
  [ -s "$PGDATA/PG_VERSION" ] && [ -f "$PGDATA/standby.signal" ] ||
    fail 'Standby refused: bootstrap an empty volume explicitly first. After deliberate promotion, set DB_ROLE=primary before restarting.'
elif [ ! -s "$PGDATA/PG_VERSION" ]; then
  # Never let initdb operate on a partially populated or failed-backup volume.
  [ -z "$(find "$PGDATA" -mindepth 1 -maxdepth 1 -print -quit)" ] ||
    fail 'Primary initialization refused: database volume is not empty.'
  TAXI_AI_APP_DATABASE_PASSWORD=$(read_password /run/secrets/app_password)
  TAXI_AI_REPLICATION_PASSWORD=$(read_password /run/secrets/replication_password)
  export TAXI_AI_APP_DATABASE_PASSWORD TAXI_AI_REPLICATION_PASSWORD
fi

mkdir -p /run/taxi-postgres
chmod 700 /run/taxi-postgres
cp /run/secrets/postgres_certificate /run/taxi-postgres/server.crt
cp /run/secrets/postgres_key /run/taxi-postgres/server.key
cp /run/secrets/replication_ca /run/taxi-postgres/ca.crt
replication_password=$(read_password /run/secrets/replication_password)
printf 'taxi-db-primary:5432:replication:taxi_replica:%s\n' "$replication_password" > /run/taxi-postgres/replication.pgpass
unset replication_password password
cat > /run/taxi-postgres/pg_hba.conf <<EOF
# The socket is container-local; only the owner may use it without a password.
local all taxi_owner trust
host taxi_ai taxi_owner 127.0.0.1/32 scram-sha-256
host taxi_ai taxi_owner $subnet scram-sha-256
host taxi_ai taxi_app $subnet scram-sha-256
# No regular database login, public range, or plaintext replication allowed.
hostssl replication taxi_replica ${TAXI_AI_REPLICATION_PEER_IP}/32 scram-sha-256
EOF
chmod 600 /run/taxi-postgres/*
chown -R postgres:postgres /run/taxi-postgres
exec /usr/local/bin/docker-entrypoint.sh postgres -c config_file=/etc/taxi/postgresql.conf
