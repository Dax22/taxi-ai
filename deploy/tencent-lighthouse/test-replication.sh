#!/usr/bin/env bash
# Isolated integration smoke: requires Docker, Compose v2 and OpenSSL.
# It never uses the deployment's .env, secrets, host ports, or named volumes.
set -euo pipefail
umask 077
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "$here/../.." && pwd)
scratch=$(mktemp -d)
suffix="$$-$RANDOM"
prefix="taxi-lighthouse-test-$suffix"
network="$prefix-network"
primary="$prefix-primary"
standby="$prefix-standby"
api="$prefix-api"
worker="$prefix-worker"
primary_volume="$prefix-primary-data"
standby_volume="$prefix-standby-data"
empty_volume="$prefix-empty-data"
app_image=${TAXI_AI_SMOKE_APP_IMAGE:-$prefix-app}
pg_image=${TAXI_AI_SMOKE_POSTGRES_IMAGE:-postgis/postgis:16-3.5}
subnet="172.29.$((RANDOM % 200 + 20))"
primary_ip="$subnet.10"
standby_ip="$subnet.11"
created_network=false
created_volumes=()
created_app_image=false

cleanup() {
  docker rm -f "$primary" "$standby" "$api" "$worker" >/dev/null 2>&1 || true
  for volume in "${created_volumes[@]}"; do docker volume rm "$volume" >/dev/null 2>&1 || true; done
  if "$created_network"; then docker network rm "$network" >/dev/null 2>&1 || true; fi
  if "$created_app_image"; then docker image rm "$app_image" >/dev/null 2>&1 || true; fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT

docker info >/dev/null
docker compose version >/dev/null
openssl version >/dev/null
docker network create --subnet "$subnet.0/24" "$network" >/dev/null
created_network=true
for volume in "$primary_volume" "$standby_volume" "$empty_volume"; do
  docker volume create "$volume" >/dev/null
  created_volumes+=("$volume")
done
mkdir -p "$scratch/secrets"
for role in owner app replication; do
  openssl rand -hex 32 > "$scratch/secrets/${role}_password"
  # These disposable random test passwords must be readable by image UID 1000.
  # Production secrets use the narrower documented owner and permissions.
  chmod 444 "$scratch/secrets/${role}_password"
done
printf '%s\n' '{"version":1,"testers":[{"name":"smoke-tester","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}' > "$scratch/secrets/testers"
chmod 444 "$scratch/secrets/testers"
sh "$here/make-replication-tls.sh" "$scratch/tls" "$primary_ip" "$standby_ip"
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 \
  -keyout "$scratch/wrong-ca.key" -out "$scratch/wrong-ca.crt" \
  -subj '/CN=Untrusted test CA' 2>/dev/null

docker pull "$pg_image"
if [ -z "${TAXI_AI_SMOKE_APP_IMAGE:-}" ]; then
  docker build -t "$app_image" "$repo"
  created_app_image=true
fi

# Validate the actual Compose model in a disposable directory. No real .env is
# created or read and no service is started by this validation.
cp "$here/compose.yml" "$scratch/compose.yml"
cp "$here/.env.example" "$scratch/.env"
cat >> "$scratch/.env" <<EOF
TAXI_AI_IMAGE=$app_image
TAXI_AI_POSTGRES_IMAGE=$pg_image
TAXI_AI_CADDY_IMAGE=caddy:2-alpine
TAXI_AI_PRIVATE_IP=$primary_ip
TAXI_AI_REPLICATION_PEER_IP=$standby_ip
TAXI_AI_PRIMARY_PRIVATE_IP=$primary_ip
TAXI_AI_PROXY_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EOF
docker compose --project-directory "$scratch" -f "$scratch/compose.yml" \
  --profile database --profile runtime --profile tooling config --quiet
docker compose --project-directory "$scratch" -f "$scratch/compose.yml" \
  --profile database --profile runtime --profile tooling config --format json > "$scratch/compose-model.json"
chmod 444 "$scratch/compose-model.json"
docker run --rm --mount "type=bind,source=$scratch/compose-model.json,target=/tmp/compose-model.json,readonly" \
  "$app_image" node -e '
    const { services } = JSON.parse(require("node:fs").readFileSync("/tmp/compose-model.json", "utf8"));
    for (const name of ["postgres", "bootstrap-replica", "migrate", "app", "worker"]) {
      const expected = ["postgres", "bootstrap-replica"].includes(name)
        ? "/run/taxi-postgres:size=2m,mode=0700" : "/tmp:size=64m,mode=1777";
      if (JSON.stringify(services[name].tmpfs) !== JSON.stringify([expected])) {
        throw new Error(`Unexpected tmpfs model for ${name}`);
      }
    }
  '

db_args=(
  --network "$network"
  -e POSTGRES_DB=taxi_ai -e POSTGRES_USER=taxi_owner
  -e POSTGRES_PASSWORD_FILE=/run/secrets/owner_password
  -e PGDATA=/var/lib/postgresql/data
  -e "TAXI_AI_DOCKER_SUBNET=$subnet.0/24"
  --mount "type=bind,source=$scratch/secrets/owner_password,target=/run/secrets/owner_password,readonly"
  --mount "type=bind,source=$scratch/secrets/app_password,target=/run/secrets/app_password,readonly"
  --mount "type=bind,source=$scratch/secrets/replication_password,target=/run/secrets/replication_password,readonly"
  --mount "type=bind,source=$here/postgres-entrypoint.sh,target=/opt/taxi/postgres-entrypoint.sh,readonly"
  --mount "type=bind,source=$here/postgresql.conf,target=/etc/taxi/postgresql.conf,readonly"
  --mount "type=bind,source=$here/init-database.sh,target=/docker-entrypoint-initdb.d/20-taxi-ai.sh,readonly"
  --tmpfs /run/taxi-postgres:rw,size=2m,mode=0700
  --add-host "taxi-db-primary:$primary_ip"
  --entrypoint sh
)
tls_args() {
  local role=$1
  host_tls=(
    --mount "type=bind,source=$scratch/tls/$role/postgres-server.crt,target=/run/secrets/postgres_certificate,readonly"
    --mount "type=bind,source=$scratch/tls/$role/postgres-server.key,target=/run/secrets/postgres_key,readonly"
    --mount "type=bind,source=$scratch/tls/$role/replication-ca.crt,target=/run/secrets/replication_ca,readonly"
  )
}
tls_args standby
if docker run --rm "${db_args[@]}" "${host_tls[@]}" \
    -e TAXI_AI_DB_ROLE=standby -e "TAXI_AI_PRIVATE_IP=$standby_ip" -e "TAXI_AI_REPLICATION_PEER_IP=$primary_ip" \
    -v "$empty_volume:/var/lib/postgresql/data" "$pg_image" /opt/taxi/postgres-entrypoint.sh \
    > "$scratch/empty.log" 2>&1; then
  printf '%s\n' 'FAIL: empty standby initialized as a primary.' >&2; exit 1
fi
case "$(cat "$scratch/empty.log")" in *'Standby refused:'*) ;; *) cat "$scratch/empty.log"; exit 1;; esac

tls_args primary
docker run -d --name "$primary" --ip "$primary_ip" "${db_args[@]}" "${host_tls[@]}" \
  -e TAXI_AI_DB_ROLE=primary -e "TAXI_AI_PRIVATE_IP=$primary_ip" -e "TAXI_AI_REPLICATION_PEER_IP=$standby_ip" \
  -v "$primary_volume:/var/lib/postgresql/data" "$pg_image" /opt/taxi/postgres-entrypoint.sh >/dev/null

sql() { docker exec "$1" psql -U taxi_owner -d taxi_ai -At --set ON_ERROR_STOP=1 -c "$2"; }
wait_sql() {
  local host=$1 query=$2 expected=$3 result
  for ((attempt=0; attempt<60; attempt++)); do
    result=''
    if docker exec "$host" pg_isready -q -h 127.0.0.1 -U taxi_owner -d taxi_ai >/dev/null 2>&1; then
      result=$(sql "$host" "$query" 2>/dev/null || true)
    fi
    if [ "$result" = "$expected" ]; then return; fi
    sleep 1
  done
  printf 'FAIL: database check timed out (%s).\n' "$host" >&2
  docker logs --tail 40 "$host" >&2
  exit 1
}
wait_sql "$primary" 'SELECT pg_is_in_recovery()' f

launch() {
  local ip=$1 role=$2
  docker run --rm --network "$network" --add-host "postgres:$ip" \
    --mount "type=bind,source=$here/launch.mjs,target=/app/deploy-launch.mjs,readonly" \
    --mount "type=bind,source=$scratch/secrets/app_password,target=/run/secrets/app_password,readonly" \
    --mount "type=bind,source=$scratch/secrets/owner_password,target=/run/secrets/owner_password,readonly" \
    "$app_image" node /app/deploy-launch.mjs "$role"
}
start_runtime() {
  local ip=$1 name role
  for role in api worker; do
    if [ "$role" = api ]; then name=$api; else name=$worker; fi
    docker run -d --name "$name" --network "$network" --add-host "postgres:$ip" \
      --read-only --cap-drop ALL --security-opt no-new-privileges:true \
      --tmpfs /tmp:rw,size=64m,mode=1777 \
      -e TAXI_AI_PUBLIC_ORIGIN=https://taxi-pilot.example.test \
      -e TAXI_AI_PROXY_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
      -e TAXI_AI_STAGING_ACCESS_FILE=/run/secrets/testers \
      -e TAXI_AI_RIDES_PAUSED=true -e TAXI_AI_MAPS_MODE=off \
      -e TAXI_AI_WORKER_REGIONS=auto -e TAXI_AI_WORKER_CONCURRENCY=2 \
      --mount "type=bind,source=$here/launch.mjs,target=/app/deploy-launch.mjs,readonly" \
      --mount "type=bind,source=$scratch/secrets/app_password,target=/run/secrets/app_password,readonly" \
      --mount "type=bind,source=$scratch/secrets/testers,target=/run/secrets/testers,readonly" \
      "$app_image" node /app/deploy-launch.mjs "$role" >/dev/null
    local healthy=false
    for ((attempt=0; attempt<60; attempt++)); do
      if docker exec "$name" node scripts/healthcheck.mjs >/dev/null 2>&1; then healthy=true; break; fi
      sleep 1
    done
    if ! "$healthy"; then
      printf 'FAIL: %s readiness timed out.\n' "$role" >&2
      docker logs --tail 40 "$name" >&2
      exit 1
    fi
  done
  docker exec "$api" node /app/deploy-launch.mjs config
}
launch "$primary_ip" migrate
start_runtime "$primary_ip"
sql "$primary" 'CREATE TABLE taxi_replication_smoke (id integer PRIMARY KEY); INSERT INTO taxi_replication_smoke VALUES (1)' >/dev/null

bootstrap() {
  local volume=$1 ca=$2
  docker run --rm --network "$network" --ip "$standby_ip" \
    --add-host "taxi-db-primary:$primary_ip" -e TAXI_AI_DB_ROLE=standby \
    -e PGDATA=/var/lib/postgresql/data \
    --mount "type=bind,source=$here/bootstrap-replica.sh,target=/opt/taxi/bootstrap-replica.sh,readonly" \
    --mount "type=bind,source=$scratch/secrets/replication_password,target=/run/secrets/replication_password,readonly" \
    --mount "type=bind,source=$ca,target=/run/secrets/replication_ca,readonly" \
    --tmpfs /run/taxi-postgres:rw,size=2m,mode=0700 \
    -v "$volume:/var/lib/postgresql/data" --entrypoint sh "$pg_image" /opt/taxi/bootstrap-replica.sh
}
if bootstrap "$empty_volume" "$scratch/wrong-ca.crt" > "$scratch/tls.log" 2>&1; then
  printf '%s\n' 'FAIL: replication trusted an unrelated CA.' >&2; exit 1
fi
case "$(cat "$scratch/tls.log")" in *'certificate verify failed'*) ;; *) cat "$scratch/tls.log"; exit 1;; esac
bootstrap "$standby_volume" "$scratch/tls/standby/replication-ca.crt"
if bootstrap "$standby_volume" "$scratch/tls/standby/replication-ca.crt" > "$scratch/overwrite.log" 2>&1; then
  printf '%s\n' 'FAIL: bootstrap accepted a populated standby volume.' >&2; exit 1
fi
case "$(cat "$scratch/overwrite.log")" in *'Refusing to overwrite'*) ;; *) cat "$scratch/overwrite.log"; exit 1;; esac
# Verify generated recovery configuration references a file, never its contents.
docker run --rm -v "$standby_volume:/data:ro" \
  --mount "type=bind,source=$scratch/secrets/replication_password,target=/password,readonly" \
  --entrypoint sh "$pg_image" -ec '
    secret=$(cat /password)
    case "$(cat /data/postgresql.auto.conf)" in *"$secret"*) exit 1;; esac
    case "$(cat /data/postgresql.auto.conf)" in *"sslmode=verify-full"*"passfile="*|*"passfile="*"sslmode=verify-full"*) ;; *) exit 1;; esac
  '

tls_args standby
docker run -d --name "$standby" --ip "$standby_ip" "${db_args[@]}" "${host_tls[@]}" \
  -e TAXI_AI_DB_ROLE=standby -e "TAXI_AI_PRIVATE_IP=$standby_ip" -e "TAXI_AI_REPLICATION_PEER_IP=$primary_ip" \
  -v "$standby_volume:/var/lib/postgresql/data" "$pg_image" /opt/taxi/postgres-entrypoint.sh >/dev/null
wait_sql "$standby" 'SELECT pg_is_in_recovery()' t
sql "$primary" 'INSERT INTO taxi_replication_smoke VALUES (2)' >/dev/null
wait_sql "$standby" 'SELECT count(*) FROM taxi_replication_smoke' 2
wait_sql "$primary" "SELECT s.ssl FROM pg_stat_replication r JOIN pg_stat_ssl s USING (pid) WHERE r.application_name = 'taxi_lighthouse_standby'" t
for role in check migrate api worker; do
  if launch "$standby_ip" "$role" > "$scratch/guard.log" 2>&1; then
    printf 'FAIL: %s guard accepted a read-only standby.\n' "$role" >&2; exit 1
  fi
  case "$(cat "$scratch/guard.log")" in *'Startup refused:'*) ;; *) cat "$scratch/guard.log"; exit 1;; esac
done

# The old primary is stopped FIRST. Production fencing must also prevent it
# restarting or accepting traffic; this is deliberately not an auto-failover tool.
docker stop -t 20 "$api" "$worker" >/dev/null
docker rm "$api" "$worker" >/dev/null
docker stop -t 20 "$primary" >/dev/null
docker exec --user postgres "$standby" pg_ctl promote -D /var/lib/postgresql/data -w -t 30
wait_sql "$standby" 'SELECT pg_is_in_recovery()' f
launch "$standby_ip" check
sql "$standby" 'INSERT INTO taxi_replication_smoke VALUES (3)' >/dev/null
wait_sql "$standby" 'SELECT count(*) FROM taxi_replication_smoke' 3
start_runtime "$standby_ip"
printf '%s\n' 'PASS: Compose, empty-volume guard, CA rejection, TLS replication, safe bootstrap, writable-primary guards, API/worker health, and fenced manual promotion.'
