#!/bin/sh
set -e
# En Railway / hosting sin compose: establece GIRONA_DB_SKIP_WAIT=1 para no esperar TCP
# antes de iniciar uvicorn (usa solo DATABASE_URL desde el lado de la app).
if [ "${GIRONA_DB_SKIP_WAIT:-}" = "1" ]; then
  exec "$@"
fi

DB_HOST="${GIRONA_DB_WAIT_HOST:-host.docker.internal}"
DB_PORT="${GIRONA_DB_WAIT_PORT:-25432}"
if [ -n "$DB_PORT" ]; then
  echo "Esperando ${DB_HOST}:${DB_PORT}..."
  i=0
  while [ "$i" -lt 60 ]; do
    if python -c "import socket; s=socket.create_connection(('${DB_HOST}', int('${DB_PORT}')), 2); s.close()" 2>/dev/null; then
      echo "Puerto de base de datos alcanzable."
      break
    fi
    i=$((i + 1))
    sleep 1
  done
fi
exec "$@"