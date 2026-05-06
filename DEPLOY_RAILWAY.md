# Despliegue del backend en Railway

Guia para subir `girona-back` a [Railway](https://railway.com) con Postgres administrado y reutilizando los datos de Render / Docker local.

> El frontend (`girona-front`) **no** se cubre aqui: solo backend + base de datos.

## 1. Que ya viene preparado en el repo

- `girona-back/Dockerfile`
  - `EXPOSE 8000` y `CMD` que respeta `${PORT}` (Railway inyecta `PORT` en runtime).
- `girona-back/docker-entrypoint.sh`
  - Si `GIRONA_DB_SKIP_WAIT=1`, **no** intenta esperar TCP a `host.docker.internal` (eso solo aplica al `docker-compose` local).
- `girona-back/railway.json`
  - Builder = `DOCKERFILE`, healthcheck en `/docs`.
- `girona-back/.dockerignore`
  - Evita subir `.venv`, `*.db`, `*.backup`, `.env*` etc. al build.
- `girona-back/.env.railway.example`
  - Plantilla con todas las variables a configurar en el panel.

## 2. Crear el proyecto en Railway

1. Entra a [railway.com/new](https://railway.com/new) y crea un proyecto vacio.
2. Anade un **Postgres** (`+ Create` -> `Database` -> `Add PostgreSQL`).
3. Anade el backend (`+ Create` -> `GitHub Repo`) y elige tu repo. Si te aparecen varias detecciones automaticas, descartalas: vamos a fijar el directorio raiz manualmente.
4. En el servicio del backend, abre **Settings**:
   - **Root Directory**: `girona-back`
   - **Builder**: `Dockerfile` (Railway lo detecta solo gracias a `railway.json`).
   - **Watch Paths** (opcional): `girona-back/**` para evitar redeploys cuando solo toques el frontend.
   - **Health Check Path**: `/docs` (el `railway.json` ya lo define).
5. En **Networking** del servicio, genera un dominio publico (`Generate Domain`) si quieres acceso desde fuera.

## 3. Variables de entorno

En el servicio del backend ve a **Variables -> Raw editor** y pega el contenido de `girona-back/.env.railway.example`. Luego completa:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
  - Si el plugin de Postgres tiene otro nombre, cambialo. Esto usa la red privada (sin SSL).
- `GIRONA_DB_SKIP_WAIT=1` (ya viene puesto, no lo borres).
- `AUTO_CREATE_TABLES=1`, `AUTO_MIGRATE_SCHEMA=1`.
- Credenciales de Factus (si `FACTUS_ENABLED=1`).
- `GOOGLE_SERVICE_ACCOUNT_JSON` si vas a usar Google Calendar.

> Railway expone `PORT` automaticamente; **no la definas a mano**.

Tras guardar, el deploy arranca solo. En **Deployments -> View Logs** debe verse algo asi:

```
INFO: Started server process [...]
INFO: Uvicorn running on http://0.0.0.0:<PORT>
```

Verifica el healthcheck abriendo `https://<tu-dominio>.up.railway.app/docs`.

## 4. Cargar los datos existentes

La base que crea Railway viene **vacia**. Es el mismo flujo que Render: tomar un dump custom (`pg_dump -Fc`) y restaurarlo contra la URL **publica** de Railway.

### 4.1 Generar el dump (si no lo tienes)

Desde la raiz del repo, con la copia local en Docker:

```bash
docker compose up -d db
./deploy/portable/restore-db.sh girona-back/girona_dev.backup   # solo si la BD local esta vacia
docker compose exec -T db pg_dump -U girona_user -d girona_prod -Fc > ./girona_para_railway.dump
```

Ajusta usuario/base si tu `.env` usa otros valores.

### 4.2 Tomar la URL publica de Railway

En el servicio **Postgres** -> **Variables**, copia `DATABASE_PUBLIC_URL`. Tipicamente:

```
postgresql://postgres:<password>@<host>.proxy.rlwy.net:<puerto>/railway
```

Si tu cliente la rechaza por SSL, anade `?sslmode=require` al final.

### 4.3 Limpiar y restaurar (sin instalar `postgresql-client` en el host)

```bash
export DATABASE_URL_RAILWAY='postgresql://postgres:...@...proxy.rlwy.net:.../railway?sslmode=require'

# 1) Vaciar el esquema public para que pg_restore no choque con FKs.
docker run --rm \
  -e DATABASE_URL="$DATABASE_URL_RAILWAY" \
  postgres:16 \
  sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'

# 2) Restaurar el dump.
docker run --rm \
  -e DATABASE_URL="$DATABASE_URL_RAILWAY" \
  -v "$PWD:/dump:ro" \
  postgres:16 \
  sh -c 'pg_restore --verbose --no-owner --no-privileges -d "$DATABASE_URL" /dump/girona_para_railway.dump'
```

Notas:

- Las comillas simples en `DATABASE_URL_RAILWAY` evitan que la shell expanda `$` o `?`.
- `pg_restore ... -d "$DATABASE_URL"` debe ir dentro de `sh -c '...'` para que la URL se resuelva **dentro** del contenedor.
- No uses `--clean` en `pg_restore` si ya hiciste `DROP SCHEMA public CASCADE`.

### 4.4 Verificar

```bash
docker run --rm \
  -e DATABASE_URL="$DATABASE_URL_RAILWAY" \
  postgres:16 \
  sh -c 'psql "$DATABASE_URL" -c "SELECT count(*) FROM waiters;"'
```

Y en el navegador `https://<tu-dominio>.up.railway.app/docs` debe listar todos los endpoints de FastAPI; los GET de `/menu`, `/inventory`, etc. deben devolver datos.

## 5. Re-deploys posteriores

- `git push` en la rama configurada en Railway redeploya solo el servicio del backend (gracias a `Watch Paths`).
- Para forzar uno manual: **Deployments -> Redeploy**.
- Si cambias columnas, deja `AUTO_MIGRATE_SCHEMA=1`; el `_auto_migrate_schema()` de `app/main.py` se ejecuta al arrancar.

## 6. Problemas comunes

- **`OperationalError: connection refused`** -> revisa que `DATABASE_URL` use la URL **interna** (`${{Postgres.DATABASE_URL}}`) y no la `DATABASE_PUBLIC_URL` (la publica solo es para tu PC).
- **El backend se cae despues de 60 s del primer arranque** -> sube `healthcheckTimeout` en `railway.json` o asegura que `AUTO_CREATE_TABLES` no este creando todo desde cero contra una BD remota lenta.
- **`/docs` devuelve 404** -> alguien borro la app de Swagger; cambia `healthcheckPath` en `railway.json` a `/openapi.json`.
- **Costos** -> Railway cobra por uso. Para ahorrar, en **Settings -> Sleep** activa "Sleep when inactive" en entornos no productivos.
