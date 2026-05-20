#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
BACKUP_PATH="${1:-$ROOT_DIR/girona-back/girona_dev.backup}"

if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Error: no existe el backup en $BACKUP_PATH" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker no está disponible en PATH." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml")
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose -f "$ROOT_DIR/docker-compose.yml")
else
  cat >&2 <<'EOF'
Error: Docker está instalado, pero Docker Compose no está disponible.

En Fedora normalmente se instala con:
  sudo dnf install docker-compose-plugin

Después verifica:
  docker compose version
EOF
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Error: Docker Compose existe, pero este usuario no puede conectarse a Docker.

Opción rápida:
  sudo bash deploy/portable/restore-db.sh girona-back/girona_dev.backup

O configura permisos para usar Docker sin sudo:
  sudo groupadd -f docker
  sudo usermod -aG docker "$USER"
  newgrp docker

Después verifica:
  docker info
EOF
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

POSTGRES_DB="${POSTGRES_DB:-girona_prod}"
POSTGRES_USER="${POSTGRES_USER:-girona_user}"

"${COMPOSE[@]}" up -d db

echo "Esperando a que PostgreSQL esté listo..."
until "${COMPOSE[@]}" exec -T db pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; do
  sleep 2
done

echo "Recargando BD completa desde el backup ($BACKUP_PATH)..."
echo "(Se eliminan conexiones a $POSTGRES_DB y se borra/recréa la base; igual que un restore limpio)"

"${COMPOSE[@]}" exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB} WITH (FORCE);" \
  -c "CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};"

"${COMPOSE[@]}" exec -i -T db pg_restore --no-owner --no-privileges -U "$POSTGRES_USER" -d "${POSTGRES_DB}" \
  < "${BACKUP_PATH}"

echo "Backup restaurado correctamente desde $BACKUP_PATH"
echo "Si el backend ya estaba en marcha: ${COMPOSE[*]} restart backend frontend"
