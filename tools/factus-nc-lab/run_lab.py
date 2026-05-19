#!/usr/bin/env python3
from __future__ import annotations

"""
Laboratorio aislado: POST /v1/credit-notes/validate (Factus crear-y-validar).
Sin dependencias externas ni imports del monorepo Girona.
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

_NS_UBL = {
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
}


def _to_bool(raw: str | None, default: bool = False) -> bool:
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def _to_int(raw: str | None, default: int | None = None) -> int | None:
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(str(raw).strip())
    except ValueError:
        return default


def _float_safe(raw: str | None, default: float) -> float:
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(str(raw).strip())
    except ValueError:
        return default


def _extract_message(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in ("message", "error", "detail", "msg"):
        v = payload.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    errs = payload.get("errors")
    if isinstance(errs, list) and errs:
        try:
            return json.dumps(errs, ensure_ascii=False)[:800]
        except (TypeError, ValueError):
            return str(errs)[:800]
    return None


def _load_json_path(path: str) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _database_url() -> str:
    explicit = (os.getenv("DATABASE_URL") or "").strip()
    if explicit:
        return explicit
    user = (os.getenv("POSTGRES_USER") or "girona_user").strip()
    password = (os.getenv("POSTGRES_PASSWORD") or "girona_pass_change_me").strip()
    host = (os.getenv("LAB_DB_HOST") or "host.docker.internal").strip()
    port = (os.getenv("POSTGRES_HOST_PORT") or "25432").strip()
    db = (os.getenv("POSTGRES_DB") or "girona_prod").strip()
    return (
        "postgresql://"
        f"{urllib.parse.quote_plus(user)}:{urllib.parse.quote_plus(password)}"
        f"@{host}:{port}/{db}"
    )


def _fetch_invoice_request_payload_from_db(bill_id: int) -> dict[str, Any]:
    try:
        import psycopg2
    except ImportError as exc:
        raise SystemExit(
            "Falta psycopg2. Ejecuta: docker compose build"
        ) from exc

    url = _database_url()
    try:
        conn = psycopg2.connect(url, connect_timeout=12)
    except Exception as exc:
        raise SystemExit(
            f"No se pudo conectar a Postgres ({url.split('@')[-1]}): {exc}\n"
            "Revisa POSTGRES_* en .env raíz y que el contenedor db de gironastack esté arriba."
        ) from exc
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT request_payload
                FROM electronic_invoices
                WHERE factus_bill_id = %s
                LIMIT 1
                """,
                (bill_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if not row or row[0] is None:
        raise SystemExit(
            f"No hay fila en electronic_invoices con factus_bill_id={bill_id} "
            "o request_payload es NULL."
        )
    payload = row[0]
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        raise SystemExit("electronic_invoices.request_payload no es un objeto JSON.")
    return payload


def _items_from_invoice_request(inv: dict[str, Any]) -> list[dict[str, Any]]:
    items = inv.get("items")
    if not isinstance(items, list) or not items:
        raise SystemExit(
            "request_payload de la factura no tiene 'items' (array no vacío). "
            "Exporta ítems manualmente con --items."
        )
    return items


def load_factus_env() -> dict[str, Any]:
    environment = os.getenv("FACTUS_ENVIRONMENT", "sandbox").strip().lower()
    if environment not in {"sandbox", "production"}:
        raise SystemExit("FACTUS_ENVIRONMENT debe ser 'sandbox' o 'production'")

    default_api = (
        "https://api-sandbox.factus.com.co"
        if environment == "sandbox"
        else "https://api.factus.com.co"
    )
    api_base_url = os.getenv("FACTUS_API_BASE_URL", default_api).strip().rstrip("/")
    token_url = os.getenv("FACTUS_TOKEN_URL", f"{api_base_url}/oauth/token").strip()

    client_id = (os.getenv("FACTUS_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("FACTUS_CLIENT_SECRET") or "").strip()
    username = (os.getenv("FACTUS_USERNAME") or "").strip()
    password = (os.getenv("FACTUS_PASSWORD") or "").strip()
    missing = [k for k, v in (
        ("FACTUS_CLIENT_ID", client_id),
        ("FACTUS_CLIENT_SECRET", client_secret),
        ("FACTUS_USERNAME", username),
        ("FACTUS_PASSWORD", password),
    ) if not v]
    if missing:
        raise SystemExit(f"Faltan variables de entorno: {', '.join(missing)}")

    return {
        "environment": environment,
        "api_base_url": api_base_url,
        "token_url": token_url,
        "client_id": client_id,
        "client_secret": client_secret,
        "username": username,
        "password": password,
    }


def fetch_access_token(conf: dict[str, Any]) -> str:
    form_data = urllib.parse.urlencode(
        {
            "grant_type": "password",
            "client_id": conf["client_id"],
            "client_secret": conf["client_secret"],
            "username": conf["username"],
            "password": conf["password"],
        },
        safe="@",
    ).encode("utf-8")
    request = urllib.request.Request(
        url=conf["token_url"],
        data=form_data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "curl/8.5.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            payload = {"raw": body}
        msg = _extract_message(payload) or f"Error OAuth Factus HTTP {exc.code}"
        raise SystemExit(msg) from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"No se pudo conectar al token de Factus: {exc.reason}") from exc

    token = payload.get("access_token")
    if not isinstance(token, str) or not token.strip():
        raise SystemExit("Factus no devolvió access_token")
    return token.strip()


def _factus_http_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "curl/8.5.0",
    }


def http_get_json(url: str, headers: dict[str, str], timeout: int = 25) -> Any:
    merged = {**headers, "User-Agent": "curl/8.5.0", "Accept": "application/json"}
    merged.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url=url, headers=merged, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(err_body) if err_body else {}
        except json.JSONDecodeError:
            payload = {"raw": err_body}
        msg = _extract_message(payload) or f"HTTP {exc.code}"
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(msg) from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"No se pudo conectar: {exc.reason}") from exc


def http_post_json(url: str, headers: dict[str, str], body: dict[str, Any], timeout: int = 25) -> Any:
    merged = {
        **headers,
        "Accept": "application/json",
        "User-Agent": "curl/8.5.0",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url=url, data=data, headers=merged, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(err_body) if err_body else {}
        except json.JSONDecodeError:
            payload = {"raw": err_body}
        msg = _extract_message(payload) or f"HTTP {exc.code}"
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(msg) from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"No se pudo conectar: {exc.reason}") from exc


def extract_credit_note_meta(response_payload: Any) -> tuple[int | None, str | None]:
    if not isinstance(response_payload, dict):
        return None, None
    wrapped = response_payload.get("credit_note")
    if not isinstance(wrapped, dict) and isinstance(response_payload.get("data"), dict):
        wrapped = response_payload["data"].get("credit_note")
    if not isinstance(wrapped, dict):
        return None, None
    cn_id: int | None = None
    raw_id = wrapped.get("id")
    if raw_id is not None:
        try:
            cn_id = int(raw_id)
        except (TypeError, ValueError):
            cn_id = None
    cn_num: str | None = None
    raw_num = wrapped.get("number")
    if raw_num is not None:
        cn_num = str(raw_num)
    return cn_id, cn_num


def _factus_bills_list_data(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if not isinstance(data, dict):
        return []
    inner = data.get("data")
    return inner if isinstance(inner, list) else []


def factus_resolve_bill_id(conf: dict[str, Any], token: str, invoice_number: str) -> int:
    q = urllib.parse.urlencode(
        {"filter[number]": invoice_number.strip(), "filter[status]": "1"}
    )
    url = f"{conf['api_base_url']}/v1/bills?{q}"
    payload = http_get_json(url, _factus_http_headers(token))
    rows = _factus_bills_list_data(payload)
    if not rows:
        raise SystemExit(
            f"No se encontró factura validada filter[number]={invoice_number!r} en Factus."
        )
    raw_id = rows[0].get("id")
    try:
        return int(raw_id)
    except (TypeError, ValueError):
        raise SystemExit(f"Respuesta Factus sin id numérico para la factura {invoice_number!r}") from None


def factus_invoice_xml_bytes(conf: dict[str, Any], token: str, invoice_number: str) -> bytes:
    safe = urllib.parse.quote(str(invoice_number).strip(), safe="")
    url = f"{conf['api_base_url']}/v1/bills/download-xml/{safe}"
    payload = http_get_json(url, _factus_http_headers(token))
    if not isinstance(payload, dict):
        raise SystemExit("Respuesta download-xml inválida")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise SystemExit("download-xml sin data")
    b64 = data.get("xml_base_64_encoded")
    if not isinstance(b64, str) or not b64.strip():
        raise SystemExit("download-xml sin xml_base_64_encoded")
    try:
        return base64.b64decode(b64)
    except (ValueError, TypeError) as exc:
        raise SystemExit(f"No se pudo decodificar XML en base64: {exc}") from exc


def cn_items_from_ubl_invoice_xml(xml_bytes: bytes) -> list[dict[str, Any]]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise SystemExit(f"XML de factura inválido: {exc}") from exc

    lines = root.findall(".//cac:InvoiceLine", _NS_UBL)
    if not lines:
        raise SystemExit("El XML no contiene cac:InvoiceLine")

    unit_measure_id = _to_int(os.getenv("FACTUS_ITEM_UNIT_MEASURE_ID"), 70) or 70
    standard_code_id = _to_int(os.getenv("FACTUS_ITEM_STANDARD_CODE_ID"), 1) or 1
    tribute_id = _to_int(os.getenv("FACTUS_ITEM_TRIBUTE_ID"), 2) or 2

    items: list[dict[str, Any]] = []
    for line in lines:
        desc_el = line.find("cac:Item/cbc:Description", _NS_UBL)
        name = (desc_el.text or "").strip() if desc_el is not None else ""
        sid_el = line.find("cac:Item/cac:StandardItemIdentification/cbc:ID", _NS_UBL)
        lid_el = line.find("cbc:ID", _NS_UBL)
        if sid_el is not None and (sid_el.text or "").strip():
            code_ref = str(sid_el.text).strip()
        elif lid_el is not None and (lid_el.text or "").strip():
            code_ref = str(lid_el.text).strip()
        else:
            code_ref = "1"

        qty_el = line.find("cbc:InvoicedQuantity", _NS_UBL)
        qty_raw = str(qty_el.text).strip() if qty_el is not None and qty_el.text else "1"
        qty_dec = Decimal(qty_raw)
        if qty_dec != qty_dec.to_integral_value():
            raise SystemExit(
                f"Línea {code_ref}: cantidad no entera ({qty_raw}). Factura no apta para este armado automático."
            )
        qty = int(qty_dec)
        if qty <= 0:
            raise SystemExit(f"Línea {code_ref}: cantidad inválida ({qty})")

        line_ext_el = line.find("cbc:LineExtensionAmount", _NS_UBL)
        line_ext = (
            Decimal(str(line_ext_el.text))
            if line_ext_el is not None and line_ext_el.text
            else Decimal("0")
        )

        tax_amt = Decimal("0")
        tax_pct = Decimal("0")
        tax_total = line.find("cac:TaxTotal", _NS_UBL)
        if tax_total is not None:
            ta = tax_total.find("cbc:TaxAmount", _NS_UBL)
            if ta is not None and ta.text:
                tax_amt = Decimal(str(ta.text))
            ts = tax_total.find("cac:TaxSubtotal", _NS_UBL)
            if ts is not None:
                pct_el = ts.find("cac:TaxCategory/cbc:Percent", _NS_UBL)
                if pct_el is not None and pct_el.text:
                    tax_pct = Decimal(str(pct_el.text))

        gross_line = line_ext + tax_amt
        unit_gross = (gross_line / qty_dec).quantize(Decimal("0.01"))
        tax_rate_str = f"{tax_pct.quantize(Decimal('0.01')):.2f}"
        is_excluded = 1 if tax_pct <= 0 else 0

        items.append(
            {
                "code_reference": code_ref,
                "name": name or code_ref,
                "quantity": qty,
                "discount_rate": 0.0,
                "price": float(unit_gross),
                "tax_rate": tax_rate_str,
                "unit_measure_id": unit_measure_id,
                "standard_code_id": standard_code_id,
                "is_excluded": is_excluded,
                "tribute_id": tribute_id,
                "withholding_taxes": [],
            }
        )
    return items


def _one_item_from_env() -> list[dict[str, Any]]:
    code = (os.getenv("LAB_ITEM_CODE_REFERENCE") or "1").strip()
    name = (os.getenv("LAB_ITEM_NAME") or "Item laboratorio").strip()
    qty = _to_int(os.getenv("LAB_ITEM_QUANTITY"), 1) or 1
    price = _float_safe(os.getenv("LAB_ITEM_PRICE"), 1000.0)
    tax_rate_raw = os.getenv("LAB_ITEM_TAX_RATE", "8.00").strip()
    try:
        tax_dec = Decimal(str(tax_rate_raw)).quantize(Decimal("0.01"))
    except Exception:
        tax_dec = Decimal("8.00")
    tax_rate_percent = float(tax_dec)
    unit_measure_id = _to_int(os.getenv("FACTUS_ITEM_UNIT_MEASURE_ID"), 70) or 70
    standard_code_id = _to_int(os.getenv("FACTUS_ITEM_STANDARD_CODE_ID"), 1) or 1
    tribute_id = _to_int(os.getenv("FACTUS_ITEM_TRIBUTE_ID"), 2) or 2
    discount = _float_safe(os.getenv("LAB_ITEM_DISCOUNT_RATE"), 0.0)
    is_excluded = 1 if tax_rate_percent <= 0 else 0
    return [
        {
            "code_reference": code,
            "name": name,
            "quantity": qty,
            "discount_rate": discount,
            "price": round(price, 2),
            "tax_rate": f"{tax_dec:.2f}",
            "unit_measure_id": unit_measure_id,
            "standard_code_id": standard_code_id,
            "is_excluded": is_excluded,
            "tribute_id": tribute_id,
            "withholding_taxes": [],
        }
    ]


def _load_items(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.items:
        data = _load_json_path(args.items)
        if not isinstance(data, list):
            raise SystemExit("--items debe ser un JSON array")
        return data

    path = (os.getenv("LAB_ITEMS_FILE") or "").strip()
    if path:
        data = _load_json_path(path)
        if not isinstance(data, list):
            raise SystemExit("LAB_ITEMS_FILE debe apuntar a un JSON array")
        return data

    raw = (os.getenv("LAB_ITEMS_JSON") or "").strip()
    if raw:
        data = json.loads(raw)
        if not isinstance(data, list):
            raise SystemExit("LAB_ITEMS_JSON debe ser un array JSON")
        return data

    return _one_item_from_env()


def _establishment_from_env() -> dict[str, str | int] | None:
    name = (os.getenv("FACTUS_ESTABLISHMENT_NAME") or "").strip()
    addr = (os.getenv("FACTUS_ESTABLISHMENT_ADDRESS") or "").strip()
    phone = (os.getenv("FACTUS_ESTABLISHMENT_PHONE") or "").strip()
    email = (os.getenv("FACTUS_ESTABLISHMENT_EMAIL") or "").strip()
    mun = _to_int(os.getenv("FACTUS_ESTABLISHMENT_MUNICIPALITY_ID"))
    if name and addr and phone and email and mun is not None:
        return {
            "name": name,
            "address": addr,
            "phone_number": phone,
            "email": email,
            "municipality_id": mun,
        }
    return None


def build_payload_template(args: argparse.Namespace) -> dict[str, Any]:
    inv_xml = (getattr(args, "from_factus_xml", None) or "").strip()
    from_db = getattr(args, "from_invoice_db", False)
    if inv_xml and from_db:
        raise SystemExit("No combines --from-factus-xml con --from-invoice-db.")

    range_id = _to_int(os.getenv("FACTUS_CREDIT_NOTE_NUMBERING_RANGE_ID")) or _to_int(
        os.getenv("FACTUS_NUMBERING_RANGE_ID")
    )
    correction = _to_int(os.getenv("FACTUS_CREDIT_NOTE_CORRECTION_CODE"), 2) or 2
    customization = _to_int(os.getenv("FACTUS_CREDIT_NOTE_CUSTOMIZATION_ID"), 20) or 20
    pay_method = (os.getenv("FACTUS_PAYMENT_METHOD_CODE") or "10").strip()

    ref = (os.getenv("LAB_REFERENCE_CODE") or "").strip()
    if not ref:
        ref = f"LAB-CN-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

    bill_id: int | None = None
    items: list[dict[str, Any]]
    allowance: Any = None
    inv_est: Any = None

    if inv_xml:
        conf = load_factus_env()
        token = fetch_access_token(conf)
        bill_id = factus_resolve_bill_id(conf, token, inv_xml)
        xml_bytes = factus_invoice_xml_bytes(conf, token, inv_xml)
        items = cn_items_from_ubl_invoice_xml(xml_bytes)
    else:
        bill_id = _to_int(os.getenv("LAB_BILL_ID") or os.getenv("FACTUS_LAB_BILL_ID"))
        if bill_id is None:
            raise SystemExit(
                "Define LAB_BILL_ID con el bill_id en Factus de la factura objetivo, "
                "o usa --from-factus-xml FGn, o --payload con un JSON completo."
            )
        if from_db:
            inv_req = _fetch_invoice_request_payload_from_db(bill_id)
            items = _items_from_invoice_request(inv_req)
            allowance = inv_req.get("allowance_charges")
            inv_est = inv_req.get("establishment")
        else:
            items = _load_items(args)

    payload: dict[str, Any] = {
        "correction_concept_code": correction,
        "customization_id": customization,
        "bill_id": bill_id,
        "reference_code": ref,
        "payment_method_code": pay_method,
        "send_email": _to_bool(os.getenv("LAB_SEND_EMAIL"), default=False),
        "items": items,
    }
    if range_id is not None:
        payload["numbering_range_id"] = range_id

    if isinstance(allowance, list) and allowance:
        payload["allowance_charges"] = allowance

    obs = (os.getenv("LAB_OBSERVATION") or "").strip()
    if obs:
        payload["observation"] = obs[:250]

    if isinstance(inv_est, dict) and inv_est:
        payload["establishment"] = inv_est
    else:
        est = _establishment_from_env()
        if est:
            payload["establishment"] = est

    return payload


def resolve_payload(args: argparse.Namespace) -> dict[str, Any]:
    if args.payload:
        data = _load_json_path(args.payload)
        if not isinstance(data, dict):
            raise SystemExit("--payload debe ser un JSON object")
        return data

    env_path = (os.getenv("LAB_PAYLOAD_JSON") or "").strip()
    if env_path:
        data = _load_json_path(env_path)
        if not isinstance(data, dict):
            raise SystemExit("LAB_PAYLOAD_JSON debe apuntar a un JSON object")
        return data

    return build_payload_template(args)


def main() -> None:
    parser = argparse.ArgumentParser(description="POST Factus credit-notes/validate (lab).")
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="Solo imprime el JSON que se enviaría, sin llamar a la API.",
    )
    parser.add_argument("--payload", type=str, metavar="PATH", help="Body completo (JSON).")
    parser.add_argument(
        "--items",
        type=str,
        metavar="PATH",
        help="Array JSON de ítems (si no usas --payload).",
    )
    parser.add_argument(
        "--from-invoice-db",
        action="store_true",
        help=(
            "Cargar items (y allowance_charges / establishment si aplica) desde "
            "electronic_invoices.request_payload para LAB_BILL_ID. Requiere Postgres "
            "(POSTGRES_* o DATABASE_URL) y psycopg2 en la imagen."
        ),
    )
    parser.add_argument(
        "--from-factus-xml",
        type=str,
        metavar="FGn",
        default="",
        help=(
            "Número de factura en Factus (ej. FG2): resuelve bill_id vía API, descarga XML "
            "UBL y arma items para la NC. Úsalo si la factura no está en tu Postgres local."
        ),
    )
    args = parser.parse_args()
    if args.from_invoice_db and args.items:
        raise SystemExit("Usa solo uno: --from-invoice-db o --items, no ambos.")
    if args.from_invoice_db and args.payload:
        raise SystemExit("Usa solo uno: --from-invoice-db o --payload.")
    fx = (args.from_factus_xml or "").strip()
    if fx and args.from_invoice_db:
        raise SystemExit("Usa solo uno: --from-factus-xml o --from-invoice-db.")
    if fx and args.items:
        raise SystemExit("Usa solo uno: --from-factus-xml o --items.")
    if fx and args.payload:
        raise SystemExit("Usa solo uno: --from-factus-xml o --payload.")

    body = resolve_payload(args)
    if args.print_only:
        print(json.dumps(body, ensure_ascii=False, indent=2))
        return

    conf = load_factus_env()
    token = fetch_access_token(conf)
    url = f"{conf['api_base_url']}/v1/credit-notes/validate"
    out = http_post_json(
        url,
        headers={"Authorization": f"Bearer {token}"},
        body=body,
    )
    print(json.dumps(out, ensure_ascii=False, indent=2))
    cn_id, cn_num = extract_credit_note_meta(out)
    if cn_id is not None or cn_num:
        print(
            f"\n# nota_crédito id={cn_id!r} number={cn_num!r}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
