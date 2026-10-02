#!/bin/sh
set -eu
umask 077
if [ "$#" -ne 3 ]; then
  printf '%s\n' 'Usage: sh make-replication-tls.sh NEW_OUTPUT_DIRECTORY PRIMARY_PRIVATE_IP STANDBY_PRIVATE_IP' >&2
  exit 1
fi
out=$1
primary_ip=$2
standby_ip=$3
for ip in "$primary_ip" "$standby_ip"; do
  printf '%s\n' "$ip" | awk -F. 'NF != 4 { exit 1 } { for (i=1;i<=4;i++) if ($i !~ /^[0-9]+$/ || $i+0 > 255) exit 1 }' || {
    printf '%s\n' 'Use valid private IPv4 addresses.' >&2; exit 1;
  }
done
[ ! -e "$out" ] || { printf '%s\n' 'Refusing to replace an existing TLS directory.' >&2; exit 1; }
mkdir -p "$out/ca" "$out/primary" "$out/standby"
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
  -keyout "$out/ca/ca.key" -out "$out/ca/ca.crt" -subj '/CN=Taxi AI replication CA' \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' 2>/dev/null
for role in primary standby; do
  if [ "$role" = primary ]; then ip=$primary_ip; else ip=$standby_ip; fi
  openssl req -new -newkey rsa:3072 -sha256 -nodes \
    -keyout "$out/$role/postgres-server.key" -out "$out/$role/server.csr" \
    -subj '/CN=taxi-db-primary' 2>/dev/null
  cat > "$out/$role/extensions.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:taxi-db-primary,IP:$ip
EOF
  openssl x509 -req -sha256 -days 365 -in "$out/$role/server.csr" \
    -CA "$out/ca/ca.crt" -CAkey "$out/ca/ca.key" -CAcreateserial \
    -out "$out/$role/postgres-server.crt" -extfile "$out/$role/extensions.cnf" 2>/dev/null
  cp "$out/ca/ca.crt" "$out/$role/replication-ca.crt"
  rm "$out/$role/server.csr" "$out/$role/extensions.cnf"
done
printf '%s\n' 'TLS files created. Copy only each host folder to its protected secrets directory. Keep the CA private key offline. Renew host certificates before 365 days.'
