#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACK_DIR="$ROOT_DIR/girona-back"
FRONT_DIR="$ROOT_DIR/girona-front"

if [[ ! -d "$BACK_DIR" ]]; then
  echo "Error: no existe $BACK_DIR" >&2
  exit 1
fi

if [[ ! -d "$FRONT_DIR" ]]; then
  echo "Error: no existe $FRONT_DIR" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 no está disponible en PATH" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm no está disponible en PATH" >&2
  exit 1
fi

if [[ "${GIRONA_SKIP_DB_START:-0}" != "1" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Error: docker no está disponible en PATH. Define GIRONA_SKIP_DB_START=1 si usarás otro Postgres." >&2
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo "Error: docker compose no está disponible. Define GIRONA_SKIP_DB_START=1 si usarás otro Postgres." >&2
    exit 1
  fi

  echo "Iniciando Postgres (Docker Compose db) ..."
  docker compose up -d db

  echo "Esperando Postgres (healthcheck) ..."
  db_health=""
  for _ in {1..60}; do
    db_health="$({ docker compose ps --format json db 2>/dev/null || true; } | sed -n 's/.*"Health":"\([^"]*\)".*/\1/p' | head -n 1)"
    if [[ "$db_health" == "healthy" ]]; then
      break
    fi
    sleep 1
  done

  if [[ "$db_health" != "healthy" ]]; then
    echo "Error: Postgres no quedó healthy a tiempo." >&2
    docker compose ps db >&2 || true
    exit 1
  fi
else
  echo "Omitiendo arranque de Postgres por GIRONA_SKIP_DB_START=1."
fi

kill_tree() {
  local pid="$1"
  [[ -n "${pid:-}" ]] || return 0

  if command -v pgrep >/dev/null 2>&1; then
    local children
    children="$(pgrep -P "$pid" 2>/dev/null || true)"
    for child in $children; do
      kill_tree "$child"
    done
  else
    local children
    children="$(ps -o pid= --ppid "$pid" 2>/dev/null | tr -d ' ' || true)"
    for child in $children; do
      kill_tree "$child"
    done
  fi

  kill "$pid" 2>/dev/null || true
}

backend_pid=""
front_pid=""

cleanup() {
  set +e
  kill_tree "${front_pid:-}"
  kill_tree "${backend_pid:-}"
  wait "${front_pid:-}" 2>/dev/null || true
  wait "${backend_pid:-}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Iniciando backend (FastAPI/uvicorn) en $BACK_DIR ..."
(cd "$BACK_DIR" && exec ./build.sh) &
backend_pid="$!"

echo "Iniciando front (Next.js) en $FRONT_DIR ..."
(cd "$FRONT_DIR" && exec npm run dev) &
front_pid="$!"

echo "Backend PID: $backend_pid | Front PID: $front_pid"
echo "Ctrl+C para detener ambos."

set +e
wait -n "$backend_pid" "$front_pid"
exit_code="$?"
set -e

echo "Uno de los procesos terminó (exit=$exit_code). Deteniendo el resto..."
exit "$exit_code"
