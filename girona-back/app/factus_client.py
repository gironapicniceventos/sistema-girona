from __future__ import annotations

import base64
import binascii
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from . import models

INC_RATE_FRACTION = Decimal("0.08")


def _to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _to_int(value: str | None, default: int | None = None) -> int | None:
    if value is None or value.strip() == "":
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def _extract_message(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("message", "detail", "error"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        details = payload.get("errors") or payload.get("details")
        if isinstance(details, list) and details:
            first = details[0]
            if isinstance(first, str) and first.strip():
                return first.strip()
            if isinstance(first, dict):
                for key in ("message", "detail", "error"):
                    value = first.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()
    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, dict):
            msg = first.get("message") or first.get("detail")
            if isinstance(msg, str) and msg.strip():
                return msg.strip()
    return None


def _decimal_to_float(value: Decimal | int | float | str) -> float:
    decimal_value = value if isinstance(value, Decimal) else Decimal(str(value))
    return float(decimal_value.quantize(Decimal("0.01")))


class FactusError(Exception):
    pass


class FactusConfigError(FactusError):
    pass


class FactusTransportError(FactusError):
    pass


class FactusApiError(FactusError):
    def __init__(self, status_code: int, message: str, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


@dataclass(frozen=True)
class FactusSettings:
    enabled: bool
    environment: str
    api_base_url: str
    token_url: str
    client_id: str
    client_secret: str
    username: str
    password: str
    numbering_range_id: int | None
    payment_form_code: str
    payment_method_code: str
    default_email: str | None
    default_address: str
    default_municipality_id: int | None
    identification_document_id: int
    legal_organization_id: int
    customer_tribute_id: int
    item_standard_code_id: int
    item_unit_measure_id: int
    item_tribute_id: int
    operation_type: int
    establishment_name: str | None
    establishment_address: str | None
    establishment_phone: str | None
    establishment_email: str | None
    establishment_municipality_id: int | None
    credit_note_numbering_range_id: int | None
    credit_note_correction_code: int
    credit_note_customization_id: int

    @classmethod
    def from_env(cls) -> "FactusSettings":
        environment = os.getenv("FACTUS_ENVIRONMENT", "sandbox").strip().lower()
        if environment not in {"sandbox", "production"}:
            raise FactusConfigError("FACTUS_ENVIRONMENT debe ser 'sandbox' o 'production'")

        default_api = (
            "https://api-sandbox.factus.com.co"
            if environment == "sandbox"
            else "https://api.factus.com.co"
        )
        api_base_url = os.getenv("FACTUS_API_BASE_URL", default_api).strip().rstrip("/")
        token_url = os.getenv("FACTUS_TOKEN_URL", f"{api_base_url}/oauth/token").strip()

        return cls(
            enabled=_to_bool(os.getenv("FACTUS_ENABLED"), default=True),
            environment=environment,
            api_base_url=api_base_url,
            token_url=token_url,
            client_id=(os.getenv("FACTUS_CLIENT_ID") or "").strip(),
            client_secret=(os.getenv("FACTUS_CLIENT_SECRET") or "").strip(),
            username=(os.getenv("FACTUS_USERNAME") or "").strip(),
            password=(os.getenv("FACTUS_PASSWORD") or "").strip(),
            numbering_range_id=_to_int(os.getenv("FACTUS_NUMBERING_RANGE_ID")),
            payment_form_code=(os.getenv("FACTUS_PAYMENT_FORM_CODE") or "1").strip(),
            payment_method_code=(os.getenv("FACTUS_PAYMENT_METHOD_CODE") or "10").strip(),
            default_email=(os.getenv("FACTUS_DEFAULT_CUSTOMER_EMAIL") or "").strip() or None,
            default_address=(os.getenv("FACTUS_DEFAULT_CUSTOMER_ADDRESS") or "No informado").strip(),
            default_municipality_id=_to_int(os.getenv("FACTUS_DEFAULT_MUNICIPALITY_ID")),
            identification_document_id=_to_int(os.getenv("FACTUS_IDENTIFICATION_DOCUMENT_ID"), 3)
            or 3,
            legal_organization_id=_to_int(os.getenv("FACTUS_LEGAL_ORGANIZATION_ID"), 2) or 2,
            customer_tribute_id=_to_int(os.getenv("FACTUS_CUSTOMER_TRIBUTE_ID"), 21) or 21,
            item_standard_code_id=_to_int(os.getenv("FACTUS_ITEM_STANDARD_CODE_ID"), 1) or 1,
            item_unit_measure_id=_to_int(os.getenv("FACTUS_ITEM_UNIT_MEASURE_ID"), 70) or 70,
            item_tribute_id=_to_int(os.getenv("FACTUS_ITEM_TRIBUTE_ID"), 1) or 1,
            operation_type=_to_int(os.getenv("FACTUS_OPERATION_TYPE"), 10) or 10,
            establishment_name=(os.getenv("FACTUS_ESTABLISHMENT_NAME") or "").strip() or None,
            establishment_address=(os.getenv("FACTUS_ESTABLISHMENT_ADDRESS") or "").strip() or None,
            establishment_phone=(os.getenv("FACTUS_ESTABLISHMENT_PHONE") or "").strip() or None,
            establishment_email=(os.getenv("FACTUS_ESTABLISHMENT_EMAIL") or "").strip() or None,
            establishment_municipality_id=_to_int(os.getenv("FACTUS_ESTABLISHMENT_MUNICIPALITY_ID")),
            credit_note_numbering_range_id=_to_int(os.getenv("FACTUS_CREDIT_NOTE_NUMBERING_RANGE_ID")),
            credit_note_correction_code=_to_int(os.getenv("FACTUS_CREDIT_NOTE_CORRECTION_CODE"), 2) or 2,
            credit_note_customization_id=_to_int(os.getenv("FACTUS_CREDIT_NOTE_CUSTOMIZATION_ID"), 20) or 20,
        )

    def ensure_enabled(self) -> None:
        if not self.enabled:
            raise FactusConfigError("Factus esta deshabilitado. Configura FACTUS_ENABLED=1")
        required = {
            "FACTUS_CLIENT_ID": self.client_id,
            "FACTUS_CLIENT_SECRET": self.client_secret,
            "FACTUS_USERNAME": self.username,
            "FACTUS_PASSWORD": self.password,
        }
        missing = [k for k, v in required.items() if not v]
        if missing:
            raise FactusConfigError(f"Faltan variables de entorno: {', '.join(missing)}")


def _http_request_json(
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    payload: Any = None,
    timeout: int = 25,
) -> Any:
    body: bytes | None = None
    req_headers = headers.copy() if headers else {}
    req_headers.setdefault("Accept", "application/json")
    req_headers.setdefault("User-Agent", "curl/8.5.0")

    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")

    request = urllib.request.Request(url=url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            if not raw:
                return {}
            decoded = raw.decode("utf-8")
            return json.loads(decoded)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        payload_error: Any
        try:
            payload_error = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload_error = {"raw": raw}
        message = _extract_message(payload_error)
        if not message:
            endpoint_path = urllib.parse.urlparse(url).path or url
            raw_preview = ""
            if isinstance(payload_error, dict):
                raw_value = payload_error.get("raw")
                if isinstance(raw_value, str):
                    raw_preview = raw_value.strip().replace("\n", " ")[:160]
            message = (
                f"Factus {endpoint_path} respondio HTTP {exc.code}"
                + (f" | {raw_preview}" if raw_preview else "")
            )
        raise FactusApiError(status_code=exc.code, message=message, payload=payload_error) from exc
    except urllib.error.URLError as exc:
        raise FactusTransportError(f"No se pudo conectar con Factus: {exc.reason}") from exc


def _extract_pdf_base64(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in (
            "pdf_base_64_encoded",
            "pdf_base64_encoded",
            "pdf_base64",
            "base64",
            "file",
        ):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                candidate = value.strip()
                if candidate.lower().startswith(("http://", "https://")):
                    continue
                return candidate
        for value in payload.values():
            found = _extract_pdf_base64(value)
            if found:
                return found
    if isinstance(payload, list):
        for value in payload:
            found = _extract_pdf_base64(value)
            if found:
                return found
    return None


def fetch_access_token(settings: FactusSettings) -> str:
    settings.ensure_enabled()
    # Factus sandbox has shown intermittent auth issues when username is encoded as %40.
    # Keep '@' unescaped and send an explicit user-agent for better compatibility.
    form_data = urllib.parse.urlencode(
        {
            "grant_type": "password",
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "username": settings.username,
            "password": settings.password,
        },
        safe="@",
    ).encode("utf-8")
    request = urllib.request.Request(
        url=settings.token_url,
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
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"raw": raw}
        message = _extract_message(payload) or f"Error autenticando con Factus ({exc.code})"
        raise FactusApiError(status_code=exc.code, message=message, payload=payload) from exc
    except urllib.error.URLError as exc:
        raise FactusTransportError(f"No se pudo conectar al token de Factus: {exc.reason}") from exc

    token = payload.get("access_token")
    if not isinstance(token, str) or not token.strip():
        raise FactusConfigError("Factus no devolvio access_token")
    return token.strip()


def list_numbering_ranges(settings: FactusSettings) -> list[dict[str, Any]]:
    token = fetch_access_token(settings)
    payload = _http_request_json(
        "GET",
        f"{settings.api_base_url}/v1/numbering-ranges",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    data = payload.get("data") if isinstance(payload, dict) else None
    if isinstance(data, dict):
        nested = data.get("data")
        if isinstance(nested, list):
            return nested
    return data if isinstance(data, list) else []


def _build_customer_payload(
    settings: FactusSettings,
    customer_name: str,
    customer_identification: str,
    customer_phone: str | None,
    customer_email: str | None,
) -> dict[str, Any]:
    email = (customer_email or settings.default_email or "").strip()
    if not email:
        raise FactusConfigError(
            "Debes configurar FACTUS_DEFAULT_CUSTOMER_EMAIL o enviar email del cliente"
        )

    payload: dict[str, Any] = {
        "identification": customer_identification.strip(),
        "dv": "0",
        "company": "",
        "trade_name": "",
        "names": customer_name.strip(),
        "address": settings.default_address,
        "email": email,
        "phone": (customer_phone or "").strip() or "N/A",
        "legal_organization_id": str(settings.legal_organization_id),
        "tribute_id": str(settings.customer_tribute_id),
        "identification_document_id": settings.identification_document_id,
    }
    if settings.default_municipality_id is not None:
        payload["municipality_id"] = str(settings.default_municipality_id)
    return payload


def _build_items_payload(settings: FactusSettings, sale: models.Sale) -> list[dict[str, Any]]:
    source_items = sale.order.items if sale.order and sale.order.items else sale.items
    items_payload: list[dict[str, Any]] = []
    for index, item in enumerate(source_items, start=1):
        qty_dec = Decimal(str(item.quantity))
        if qty_dec != qty_dec.to_integral_value():
            raise FactusConfigError(
                f"El item '{item.name}' tiene cantidad no entera ({item.quantity})."
            )
        quantity = int(qty_dec)
        if quantity <= 0:
            raise FactusConfigError(f"El item '{item.name}' tiene cantidad invalida.")

        unit_price = Decimal(str(item.unit_price))
        tax_rate_fraction = Decimal(str(getattr(item, "tax_rate", INC_RATE_FRACTION)))
        if tax_rate_fraction < 0:
            tax_rate_fraction = Decimal("0")
        tax_rate_percent_decimal = (tax_rate_fraction * Decimal("100")).quantize(Decimal("0.01"))
        tax_rate_percent = _decimal_to_float(tax_rate_percent_decimal)

        line_subtotal = Decimal(str(item.line_subtotal))
        undiscounted_base = unit_price * qty_dec
        discount_total = max(undiscounted_base - line_subtotal, Decimal("0"))
        if undiscounted_base > 0:
            discount_rate = float(
                ((discount_total / undiscounted_base) * Decimal("100")).quantize(Decimal("0.01"))
            )
        else:
            discount_rate = 0.0

        items_payload.append(
            {
                "code_reference": str(item.menu_item_id or index),
                "name": item.name,
                "quantity": quantity,
                "discount_rate": discount_rate,
                "price": _decimal_to_float(unit_price),
                "tax_rate": f"{tax_rate_percent_decimal:.2f}",
                "unit_measure_id": settings.item_unit_measure_id,
                "standard_code_id": settings.item_standard_code_id,
                "is_excluded": 1 if tax_rate_percent <= 0 else 0,
                "tribute_id": settings.item_tribute_id,
                "withholding_taxes": [],
            }
        )
    if not items_payload:
        raise FactusConfigError("La venta no tiene items para facturar")
    return items_payload


def build_bill_payload(
    settings: FactusSettings,
    sale: models.Sale,
    customer_name: str,
    customer_identification: str,
    customer_phone: str | None,
    customer_email: str | None,
    numbering_range_id: int | None = None,
    reference_code: str | None = None,
) -> dict[str, Any]:
    effective_range = numbering_range_id or settings.numbering_range_id
    if effective_range is None:
        raise FactusConfigError(
            "Debes indicar numbering_range_id o configurar FACTUS_NUMBERING_RANGE_ID"
        )

    if not reference_code:
        now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        reference_code = f"SALE-{sale.id}-{now}"

    customer_payload = _build_customer_payload(
        settings=settings,
        customer_name=customer_name,
        customer_identification=customer_identification,
        customer_phone=customer_phone,
        customer_email=customer_email,
    )
    items_payload = _build_items_payload(settings, sale)

    payload: dict[str, Any] = {
        "numbering_range_id": effective_range,
        "document": "01",
        "reference_code": reference_code,
        "observation": f"Pedido POS #{sale.order_id}",
        "send_email": True,
        "payment_method_code": settings.payment_method_code,
        "payment_form_code": settings.payment_form_code,
        "operation_type": settings.operation_type,
        "customer": customer_payload,
        "items": items_payload,
    }
    if (
        settings.establishment_name
        and settings.establishment_address
        and settings.establishment_phone
        and settings.establishment_email
        and settings.establishment_municipality_id is not None
    ):
        payload["establishment"] = {
            "name": settings.establishment_name,
            "address": settings.establishment_address,
            "phone_number": settings.establishment_phone,
            "email": settings.establishment_email,
            "municipality_id": settings.establishment_municipality_id,
        }
    base_amount = Decimal(str(sale.subtotal or 0)).quantize(Decimal("0.01"))
    service_amount = Decimal(str(sale.service_total or 0)).quantize(Decimal("0.01"))
    utility_amount = Decimal(str(getattr(sale, "utility_total", 0) or 0)).quantize(
        Decimal("0.01")
    )
    allowance_charges: list[dict[str, Any]] = []
    if service_amount > 0:
        allowance_charges.append(
            {
                "concept_type": "03",
                "is_surcharge": True,
                "reason": "Propina",
                "base_amount": f"{base_amount:.2f}",
                "amount": f"{service_amount:.2f}",
            }
        )
    if utility_amount > 0:
        allowance_charges.append(
            {
                "concept_type": "03",
                "is_surcharge": True,
                "reason": "Utilidad",
                "base_amount": f"{base_amount:.2f}",
                "amount": f"{utility_amount:.2f}",
            }
        )
    if allowance_charges:
        payload["allowance_charges"] = allowance_charges
    return payload


def credit_note_validate_response_ok(cn_response: Any) -> tuple[bool, str | None]:
    """
    True sólo si Factus incluyó un credit_note con id en data (respuesta crear-y-validar).
    Evita marcar factura como voided en BD si la API devolvió 2xx pero sin NC válida.
    """
    if not isinstance(cn_response, dict):
        return False, "Respuesta de Factus no es JSON de objeto."

    data = cn_response.get("data")
    if not isinstance(data, dict):
        message = _extract_message(cn_response) or (
            "Factus no incluyó 'data' válida en la respuesta de la nota crédito."
        )
        return False, message

    cnote = data.get("credit_note")
    if not isinstance(cnote, dict):
        message = _extract_message(cn_response) or (
            "Factus no incluyó 'data.credit_note' en la respuesta de la nota crédito."
        )
        return False, message

    raw_id = cnote.get("id")
    try:
        parsed_id = int(raw_id) if raw_id is not None else None
    except (TypeError, ValueError):
        parsed_id = None
    if not parsed_id:
        suffix = ""
        errs = cnote.get("errors")
        if isinstance(errs, list) and errs:
            first_err = errs[0]
            if isinstance(first_err, str) and first_err.strip():
                suffix = f" ({first_err.strip()})"
            elif isinstance(first_err, dict):
                extracted = _extract_message(first_err)
                if extracted:
                    suffix = f" ({extracted})"
        message = _extract_message(cn_response) or (
            "Factus respondió pero la nota crédito no tiene id válido (no registrada)." + suffix
        )
        return False, message

    return True, None


def build_credit_note_void_invoice_payload(
    settings: FactusSettings,
    sale: models.Sale,
    invoice: models.ElectronicInvoice,
    *,
    numbering_range_id: int | None = None,
    observation: str | None = None,
    send_email: bool = False,
    reference_code: str | None = None,
) -> dict[str, Any]:
    """
    Nota crédito que referencia factura (customization 20) y concepto anulación (2), según Factus API.
    Ver: https://developers.factus.com.co/v1/notas-credito/crear-y-validar/
    """
    if invoice.factus_bill_id is None:
        raise FactusConfigError("La factura no tiene bill_id en Factus; no se puede emitir nota crédito")

    effective_range = (
        numbering_range_id
        or settings.credit_note_numbering_range_id
        or settings.numbering_range_id
    )
    if effective_range is None:
        raise FactusConfigError(
            "Indica numbering_range_id en la solicitud o configura "
            "FACTUS_CREDIT_NOTE_NUMBERING_RANGE_ID o FACTUS_NUMBERING_RANGE_ID "
            "(rango activo para notas crédito en Factus)."
        )

    if not reference_code:
        now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        reference_code = f"CN-SALE-{sale.id}-{now}"

    invoice_req = invoice.request_payload if isinstance(invoice.request_payload, dict) else {}
    fallback_items = _build_items_payload(settings, sale)
    persisted_items = invoice_req.get("items")
    if isinstance(persisted_items, list) and len(persisted_items) > 0:
        items_payload = persisted_items
    else:
        items_payload = fallback_items

    payload: dict[str, Any] = {
        "numbering_range_id": effective_range,
        "correction_concept_code": settings.credit_note_correction_code,
        "customization_id": settings.credit_note_customization_id,
        "bill_id": int(invoice.factus_bill_id),
        "reference_code": reference_code,
        "payment_method_code": settings.payment_method_code,
        "send_email": bool(send_email),
        "items": items_payload,
    }
    if observation and str(observation).strip():
        payload["observation"] = str(observation).strip()[:250]
    if (
        isinstance(invoice_req, dict)
        and isinstance(invoice_req.get("allowance_charges"), list)
        and invoice_req["allowance_charges"]
    ):
        payload["allowance_charges"] = invoice_req["allowance_charges"]
    persisted_establishment = (
        invoice_req.get("establishment") if isinstance(invoice_req.get("establishment"), dict) else None
    )
    if persisted_establishment:
        payload["establishment"] = persisted_establishment
    elif (
        settings.establishment_name
        and settings.establishment_address
        and settings.establishment_phone
        and settings.establishment_email
        and settings.establishment_municipality_id is not None
    ):
        payload["establishment"] = {
            "name": settings.establishment_name,
            "address": settings.establishment_address,
            "phone_number": settings.establishment_phone,
            "email": settings.establishment_email,
            "municipality_id": settings.establishment_municipality_id,
        }
    return payload


def extract_credit_note_meta(response_payload: Any) -> tuple[int | None, str | None]:
    """Lee id y número de nota crédito guardados en response_payload tras crear-y-validar."""
    if not isinstance(response_payload, dict):
        return None, None
    wrapped = response_payload.get("credit_note")
    if not isinstance(wrapped, dict):
        return None, None
    data = wrapped.get("data")
    if not isinstance(data, dict):
        return None, None
    cnote = data.get("credit_note")
    if not isinstance(cnote, dict):
        return None, None
    cn_id: int | None = None
    raw_id = cnote.get("id")
    if raw_id is not None:
        try:
            cn_id = int(raw_id)
        except (TypeError, ValueError):
            cn_id = None
    cn_num: str | None = None
    raw_num = cnote.get("number")
    if raw_num is not None:
        cn_num = str(raw_num)
    return cn_id, cn_num


def create_credit_note_validate(settings: FactusSettings, payload: dict[str, Any]) -> dict[str, Any]:
    token = fetch_access_token(settings)
    response = _http_request_json(
        "POST",
        f"{settings.api_base_url}/v1/credit-notes/validate",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        payload=payload,
    )
    return response if isinstance(response, dict) else {"raw": response}


def create_bill(settings: FactusSettings, payload: dict[str, Any]) -> dict[str, Any]:
    token = fetch_access_token(settings)
    response = _http_request_json(
        "POST",
        f"{settings.api_base_url}/v1/bills/validate",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        payload=payload,
    )
    return response if isinstance(response, dict) else {"raw": response}


def send_bill_email(
    settings: FactusSettings,
    bill_number: str,
    email: str,
    bill_id: int | None = None,
) -> dict[str, Any]:
    references: list[str | int] = []
    normalized_number = str(bill_number).strip()
    if normalized_number:
        references.append(normalized_number)
        digits_only = re.sub(r"\D+", "", normalized_number)
        if digits_only and digits_only != normalized_number:
            references.append(digits_only)
    if bill_id is not None:
        references.append(int(bill_id))

    if not references:
        raise FactusConfigError("No hay referencia valida de factura para enviar correo")

    endpoint_templates = (
        "/v1/bills/send-email/{ref}",
        "/v1/bills/{ref}/send-email",
    )

    last_error: FactusApiError | None = None
    attempted_refs = [str(reference) for reference in references]
    token = fetch_access_token(settings)
    for endpoint in endpoint_templates:
        for reference in references:
            safe_reference = urllib.parse.quote(str(reference).strip(), safe="")
            try:
                response = _http_request_json(
                    "POST",
                    f"{settings.api_base_url}{endpoint.format(ref=safe_reference)}",
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                    payload={"email": email.strip()},
                )
                return response if isinstance(response, dict) else {"raw": response}
            except FactusApiError as exc:
                last_error = exc
                if exc.status_code in {404, 405, 422}:
                    continue
                raise
    if last_error is not None:
        if last_error.status_code == 404:
            raise FactusApiError(
                status_code=404,
                message=(
                    "Factus no encontro recurso para enviar correo. "
                    f"Referencias probadas: {', '.join(attempted_refs)}"
                ),
                payload=last_error.payload,
            ) from last_error
        raise last_error
    raise FactusApiError(status_code=502, message="No se pudo enviar correo de factura")


def download_bill_pdf(settings: FactusSettings, bill_number: str) -> tuple[str, bytes]:
    token = fetch_access_token(settings)
    safe_number = urllib.parse.quote(str(bill_number).strip(), safe="")
    response = _http_request_json(
        "GET",
        f"{settings.api_base_url}/v1/bills/download-pdf/{safe_number}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    encoded = _extract_pdf_base64(response)
    if not encoded:
        raise FactusApiError(
            status_code=502,
            message="Factus no devolvio el documento PDF en la respuesta",
            payload=response,
        )
    try:
        pdf_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise FactusApiError(
            status_code=502,
            message="Factus devolvio un PDF invalido",
            payload=response,
        ) from exc

    filename = f"factura-{safe_number}.pdf"
    return filename, pdf_bytes