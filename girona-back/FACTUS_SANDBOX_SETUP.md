# Facturacion Electronica con Factus (Sandbox)

Este proyecto ya incluye integracion base para pruebas con Factus y conexion con `POS`.

## 0) Sandbox Factus (referencia)

- Consola web (pruebas): `https://app-sandbox.factus.com.co/login`
- API (pruebas): `https://api-sandbox.factus.com.co`
- **Seguridad:** no subas `Client ID`, `Client Secret`, usuario ni contraseña al repositorio. Si compartiste credenciales por un canal poco seguro, **rótalas** en el panel de Factus y actualiza tu `.env` / `.env.factus` local.

## 1) Configuracion inicial

Completa variables en `girona-back/.env` tomando como base `girona-back/.env.example`.

**Dos formas habituales:**

- **Solo backend local (`uvicorn`):** todo en `girona-back/.env` (incluye OAuth).
- **Stack Docker en la raíz del repo:** variables generales en `.env` y **credenciales OAuth** en `.env.factus` (copia de `.env.factus.example`; ese archivo está en `.gitignore`). Compose carga ambos en el servicio `backend`.

Variables minimas obligatorias:

- `FACTUS_ENABLED=1`
- `FACTUS_ENVIRONMENT=sandbox`
- `FACTUS_CLIENT_ID`
- `FACTUS_CLIENT_SECRET`
- `FACTUS_USERNAME`
- `FACTUS_PASSWORD`

Variables recomendadas para iniciar rapido:

- `FACTUS_NUMBERING_RANGE_ID` (si lo conoces)
- `FACTUS_DEFAULT_CUSTOMER_EMAIL`
- `FACTUS_DEFAULT_MUNICIPALITY_ID`
- **`FACTUS_ITEM_TRIBUTE_ID`** (tributo por linea enviado a Factus como `items[].tribute_id`). No es el codigo DIAN de la tabla (p. ej. INC = **04** en norma); es el **ID del catalogo Factus** de «tributos de productos» / lookups. En el proyecto, el valor por defecto **2** corresponde a INC (codigo DIAN **04**); **1** suele ser IVA (codigo **01**). Si tu cuenta Factus usa otros IDs, consulta la API/tablas del panel y sobrescribe la variable.

El porcentaje de impuesto va en `items[].tax_rate` (cadena tipo `8.00`); el POS ya envia INC al **8%** cuando corresponde.

### Prueba en localhost

1. Asegura `FACTUS_ENABLED=1`, `FACTUS_ENVIRONMENT=sandbox` y URLs sandbox (`FACTUS_API_BASE_URL` / `FACTUS_TOKEN_URL` como en `.env.example`).
2. Rellena OAuth (`FACTUS_CLIENT_ID`, `FACTUS_CLIENT_SECRET`, `FACTUS_USERNAME`, `FACTUS_PASSWORD`). En sandbox, `FACTUS_USERNAME` suele ser el **correo** de la cuenta Factus.
3. Arranca el backend: con **Docker** (desde la raiz del repo), `docker compose up -d --build` tras crear `.env` requerido y opcionalmente `.env.factus`; con **solo uvicorn**, `cd girona-back && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000` (o el puerto que uses). Anota el **puerto en el host** (por defecto Docker: `BACKEND_HOST_PORT` en `.env`, si no esta, `8000`).
4. Comprueba:

```bash
curl -s "http://localhost:PUERTO/factus/health" | jq
curl -s "http://localhost:PUERTO/factus/numbering-ranges" | jq
```

Si `health` devuelve `ok: true`, copia un `id` de rango activo y ponlo en `FACTUS_NUMBERING_RANGE_ID` (en `.env` raíz con Docker, o en `girona-back/.env` con `uvicorn`).

**Front en Docker:** `NEXT_PUBLIC_API_BASE_URL` debe apuntar al mismo puerto que publica el backend (Compose ya usa `http://localhost:${BACKEND_HOST_PORT:-8000}`). **Front en `npm run dev`:** en `.env.local` define `BACKEND_URL` / `NEXT_PUBLIC_API_BASE_URL` al puerto donde escuche FastAPI.

## 2) Probar conexion con Factus

Con backend corriendo:

- `GET /factus/health`
- `GET /factus/numbering-ranges`

Si `health` responde `ok: true`, la autenticacion y conexion estan listas.

## 3) Flujo operativo conectado a POS

1. En POS, crea pedido y marcalo como entregado.
2. En modal de pago, activa `Emitir factura electronica (Factus - pruebas)`.
3. Selecciona cliente existente o registra cliente nuevo.
4. Guarda pago.
5. El sistema:
   - Cierra el pedido y crea la venta local.
   - Emite factura en Factus sobre esa venta.
   - Guarda estado en tabla `electronic_invoices`.

## 4) Endpoints implementados

- `GET /factus/health`
- `GET /factus/numbering-ranges`
- `GET /factus/sales/{sale_id}/status`
- `POST /factus/sales/{sale_id}/issue`
- `GET /factus/sales/{sale_id}/document` (descarga PDF)
- `POST /factus/sales/{sale_id}/send-email` (reenviar correo)

Proxies Next.js:

- `GET /api/factus/health`
- `GET /api/factus/numbering-ranges`
- `GET /api/factus/sales/{saleId}/status`
- `POST /api/factus/sales/{saleId}/issue`
- `GET /api/factus/sales/{saleId}/document`
- `POST /api/factus/sales/{saleId}/send-email`

### Numbering range ID

- Es opcional en la UI solo si ya configuraste `FACTUS_NUMBERING_RANGE_ID` en el `.env` que use el backend (`girona-back/.env` con uvicorn, o `.env` en la raiz si corres Compose).
- Si no existe ese valor por defecto, debes enviarlo en cada emision (ej. un `id` devuelto por `/factus/numbering-ranges` en sandbox).

## 5) Tabla de trazabilidad

Tabla nueva: `electronic_invoices`

Guarda:

- estado (`pending`, `issued`, `failed`)
- referencia
- numero Factus
- CUFE
- QR
- request/response
- error tecnico

## 6) Paso a produccion

1. Cambia `FACTUS_ENVIRONMENT=production`.
2. Configura credenciales productivas.
3. Ajusta `FACTUS_API_BASE_URL` y `FACTUS_TOKEN_URL` si Factus te entrega URLs diferentes.
4. Verifica rangos productivos (`/factus/numbering-ranges`).
5. Ejecuta pruebas con ventas reales de bajo monto antes de habilitar a todos los usuarios.
