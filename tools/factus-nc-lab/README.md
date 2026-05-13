# Laboratorio Factus — nota crédito (crear y validar)

Contenedor **apartado** del `docker-compose.yml` principal: no levanta Postgres, backend ni frontend de Girona.

## Documentación de Factus

- [Crear y validar nota crédito](https://developers.factus.com.co/v1/notas-credito/crear-y-validar/) — `POST /v1/credit-notes/validate`

## Uso

Compose carga por orden `../../.env`, `../../.env.factus` y luego `./.env` (este último para `LAB_BILL_ID` u overrides). Así reutilizas las mismas credenciales que el backend.

```bash
cd tools/factus-nc-lab
# Opcional: cp .env.example .env y define solo LAB_BILL_ID si no usas la raíz del repo.
docker compose run --rm lab
```

Solo ver el cuerpo que se enviaría (sin red):

```bash
docker compose run --rm lab --print-only
```

Para una corrida puntual con otro `bill_id` sin editar `.env`:

```bash
docker compose run --rm -e LAB_BILL_ID=999999 lab --print-only
```

### Factura solo en Factus (ej. FG2 no está en tu Postgres)

Si la factura se emitió en producción y **no** tienes `request_payload` en `electronic_invoices`, el lab puede armar los ítems desde el **XML DIAN** (`GET /v1/bills/download-xml/FGn`). Los GET a Factus requieren User-Agent tipo `curl` (ya va en el script).

```bash
docker compose run --rm \
  -e FACTUS_NUMBERING_RANGE_ID= -e FACTUS_CREDIT_NOTE_NUMBERING_RANGE_ID= \
  lab --print-only --from-factus-xml FG2
```

Sin `--print-only` envía la validación a Factus (igual que con FG1). El `bill_id` se obtiene de la API (`filter[number]=FG2`); no hace falta `LAB_BILL_ID` en `.env` para este modo.

### Ítems reales (misma factura que en `electronic_invoices`)

Si la factura se emitió desde Girona, el `request_payload` guardado incluye los `items` (y a veces `allowance_charges` / `establishment`) que Factus ya validó en su día. El lab puede leerlos por `LAB_BILL_ID`:

```bash
docker compose build --no-cache   # primera vez: instala psycopg2 en la imagen
docker compose run --rm lab --print-only --from-invoice-db
```

Requiere Postgres accesible desde el contenedor: por defecto se usa `host.docker.internal` y el puerto `POSTGRES_HOST_PORT` del `.env` raíz (misma lógica que el `backend` de `gironastack`). Override: `LAB_DB_HOST` si tu red es distinta.

Con payload completo o ítems explícitos:

```bash
docker compose run --rm lab --payload examples/payload.full.example.json
docker compose run --rm lab --items examples/items.example.json
```

Variables equivalentes por entorno: `LAB_PAYLOAD_JSON` (ruta a JSON de cuerpo completo), `LAB_ITEMS_FILE` (ruta a array de ítems).

## Avisos

- **Sandbox vs producción:** `FACTUS_ENVIRONMENT=sandbox` usa `api-sandbox.factus.com.co`. Para producción, `FACTUS_ENVIRONMENT=production` y revisa URLs en `.env`.
- No commitees `.env`; usa `.env.example` como plantilla.
