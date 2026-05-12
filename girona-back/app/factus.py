from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import db, models, schemas
from .factus_client import (
    FactusApiError,
    FactusConfigError,
    FactusSettings,
    FactusTransportError,
    build_bill_payload,
    build_credit_note_void_invoice_payload,
    create_bill,
    create_credit_note_validate,
    download_bill_pdf,
    extract_credit_note_meta,
    list_numbering_ranges,
    send_bill_email,
)

router = APIRouter(prefix="/factus", tags=["factus"])


def _format_range(raw: dict) -> schemas.FactusRangeOut:
    raw_id = raw.get("id")
    try:
        parsed_id = int(raw_id) if raw_id is not None else 0
    except (TypeError, ValueError):
        parsed_id = 0
    return schemas.FactusRangeOut(
        id=parsed_id,
        prefix=str(raw.get("prefix")) if raw.get("prefix") is not None else None,
        from_number=raw.get("from"),
        to_number=raw.get("to"),
        current=raw.get("current"),
        resolution_number=(
            str(raw.get("resolution_number"))
            if raw.get("resolution_number") is not None
            else None
        ),
        is_active=raw.get("is_active"),
    )


def _sale_or_404(db_session: Session, sale_id: int) -> models.Sale:
    sale = db_session.query(models.Sale).filter(models.Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Venta no encontrada")
    return sale


def _electronic_invoice_out(invoice: models.ElectronicInvoice) -> schemas.ElectronicInvoiceOut:
    cn_id, cn_num = extract_credit_note_meta(invoice.response_payload)
    return schemas.ElectronicInvoiceOut(
        id=invoice.id,
        sale_id=invoice.sale_id,
        provider=invoice.provider,
        environment=invoice.environment,
        status=invoice.status,
        reference_code=invoice.reference_code,
        factus_bill_id=invoice.factus_bill_id,
        factus_bill_number=invoice.factus_bill_number,
        cufe=invoice.cufe,
        qr_url=invoice.qr_url,
        error_message=invoice.error_message,
        created_at=invoice.created_at,
        updated_at=invoice.updated_at,
        factus_credit_note_id=cn_id,
        factus_credit_note_number=cn_num,
    )


def _upsert_customer_for_sale(
    db_session: Session,
    sale: models.Sale,
    payload: schemas.FactusIssueInvoiceRequest | None,
) -> tuple[str, str, str | None, str | None]:
    customer_name = ""
    customer_identification = ""
    customer_phone = None
    customer_email = payload.customer_email.strip() if payload and payload.customer_email else None

    if payload and payload.customer_id is not None:
        customer = (
            db_session.query(models.Customer)
            .filter(models.Customer.id == payload.customer_id)
            .first()
        )
        if not customer:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")
        sale.customer_id = customer.id
        customer_name = customer.name.strip()
        customer_identification = customer.identity_document.strip()
        customer_phone = customer.phone.strip() if customer.phone else None
        db_session.add(sale)
        db_session.flush()

    if sale.customer:
        customer_name = sale.customer.name.strip()
        customer_identification = sale.customer.identity_document.strip()
        customer_phone = sale.customer.phone.strip() if sale.customer.phone else None

    if payload and payload.customer_name and payload.customer_identity_document:
        identity_document = payload.customer_identity_document.strip()
        existing = (
            db_session.query(models.Customer)
            .filter(func.lower(models.Customer.identity_document) == identity_document.lower())
            .first()
        )
        if existing:
            sale.customer_id = existing.id
            customer_name = existing.name.strip()
            customer_identification = existing.identity_document.strip()
            customer_phone = existing.phone.strip() if existing.phone else None
        else:
            customer = models.Customer(
                name=payload.customer_name.strip(),
                identity_document=identity_document,
                phone=payload.customer_phone.strip() if payload.customer_phone else None,
                is_active=True,
            )
            db_session.add(customer)
            db_session.flush()
            sale.customer_id = customer.id
            customer_name = customer.name.strip()
            customer_identification = customer.identity_document.strip()
            customer_phone = customer.phone.strip() if customer.phone else None
        db_session.add(sale)
        db_session.flush()

    if payload and payload.customer_phone:
        customer_phone = payload.customer_phone.strip()

    if not customer_name or not customer_identification:
        raise HTTPException(
            status_code=400,
            detail=(
                "Para facturar con Factus necesitas cliente con nombre y documento. "
                "Selecciona un cliente existente o envialo en la solicitud."
            ),
        )

    return customer_name, customer_identification, customer_phone, customer_email


@router.get("/health", response_model=schemas.FactusHealthOut)
def factus_health(db_session: Session = Depends(db.get_db)):
    del db_session
    settings = FactusSettings.from_env()
    try:
        ranges = list_numbering_ranges(settings)
    except FactusConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FactusTransportError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except FactusApiError as exc:
        detail = str(exc)
        if exc.payload is not None:
            detail = f"{detail}"
        raise HTTPException(status_code=exc.status_code, detail=detail) from exc

    parsed_ranges = [_format_range(r) for r in ranges if isinstance(r, dict)]
    return schemas.FactusHealthOut(
        ok=True,
        environment=settings.environment,
        api_base_url=settings.api_base_url,
        numbering_ranges=parsed_ranges,
    )


@router.get("/numbering-ranges", response_model=list[schemas.FactusRangeOut])
def get_numbering_ranges(db_session: Session = Depends(db.get_db)):
    del db_session
    settings = FactusSettings.from_env()
    try:
        ranges = list_numbering_ranges(settings)
    except FactusConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FactusTransportError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except FactusApiError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return [_format_range(r) for r in ranges if isinstance(r, dict)]


@router.get("/sales/{sale_id}/status", response_model=schemas.ElectronicInvoiceOut)
def factus_sale_status(sale_id: int, db_session: Session = Depends(db.get_db)):
    sale = _sale_or_404(db_session, sale_id)
    if not sale.electronic_invoice:
        raise HTTPException(
            status_code=404,
            detail="La venta no tiene factura electronica registrada",
        )
    return _electronic_invoice_out(sale.electronic_invoice)


@router.post("/sales/{sale_id}/issue", response_model=schemas.ElectronicInvoiceOut)
def issue_factus_invoice(
    sale_id: int,
    payload: schemas.FactusIssueInvoiceRequest | None = None,
    db_session: Session = Depends(db.get_db),
):
    settings = FactusSettings.from_env()
    sale = _sale_or_404(db_session, sale_id)

    customer_name, customer_identification, customer_phone, customer_email = (
        _upsert_customer_for_sale(db_session, sale, payload or schemas.FactusIssueInvoiceRequest())
    )

    invoice = sale.electronic_invoice
    if invoice and invoice.status == "issued":
        return _electronic_invoice_out(invoice)

    if invoice is None:
        invoice = models.ElectronicInvoice(
            sale_id=sale.id,
            provider="factus",
            environment=settings.environment,
            status="pending",
        )
        db_session.add(invoice)
        db_session.flush()

    try:
        request_payload = build_bill_payload(
            settings=settings,
            sale=sale,
            customer_name=customer_name,
            customer_identification=customer_identification,
            customer_phone=customer_phone,
            customer_email=customer_email,
            numbering_range_id=payload.numbering_range_id if payload else None,
            reference_code=invoice.reference_code or None,
        )
        invoice.reference_code = request_payload.get("reference_code")
        invoice.environment = settings.environment
        invoice.status = "pending"
        invoice.request_payload = request_payload
        invoice.error_message = None
        db_session.add(invoice)
        db_session.commit()
        db_session.refresh(invoice)

        response_payload = create_bill(settings, request_payload)
        bill_data = response_payload.get("data", {}) if isinstance(response_payload, dict) else {}
        customer_email_to_send = (
            customer_email.strip() if isinstance(customer_email, str) and customer_email.strip() else None
        )

        invoice.status = "issued"
        invoice.factus_bill_id = (
            int(bill_data["bill"]["id"])
            if isinstance(bill_data, dict)
            and isinstance(bill_data.get("bill"), dict)
            and bill_data["bill"].get("id") is not None
            else None
        )
        invoice.factus_bill_number = (
            str(bill_data["bill"]["number"])
            if isinstance(bill_data, dict)
            and isinstance(bill_data.get("bill"), dict)
            and bill_data["bill"].get("number") is not None
            else None
        )
        email_delivery: dict | None = None
        if customer_email_to_send:
            # Email is requested directly in bill creation payload (send_email=true).
            # Factus handles delivery asynchronously.
            email_delivery = {
                "requested": True,
                "email": customer_email_to_send,
                "ok": None,
                "mode": "provider_auto",
            }
        invoice.cufe = (
            str(bill_data.get("cufe"))
            if isinstance(bill_data, dict) and bill_data.get("cufe") is not None
            else None
        )
        invoice.qr_url = (
            str(bill_data.get("qr"))
            if isinstance(bill_data, dict) and bill_data.get("qr") is not None
            else None
        )
        if email_delivery and isinstance(response_payload, dict):
            response_payload["email_delivery"] = email_delivery
        invoice.response_payload = response_payload
        invoice.error_message = None
        db_session.add(invoice)
        db_session.commit()
        db_session.refresh(invoice)
        return _electronic_invoice_out(invoice)
    except FactusConfigError as exc:
        invoice.status = "failed"
        invoice.error_message = str(exc)
        db_session.add(invoice)
        db_session.commit()
        db_session.refresh(invoice)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FactusTransportError as exc:
        invoice.status = "failed"
        invoice.error_message = str(exc)
        db_session.add(invoice)
        db_session.commit()
        db_session.refresh(invoice)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except FactusApiError as exc:
        invoice.status = "failed"
        invoice.error_message = str(exc)
        invoice.response_payload = exc.payload
        db_session.add(invoice)
        db_session.commit()
        db_session.refresh(invoice)
        status_code = exc.status_code if 400 <= exc.status_code < 500 else 502
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.get("/sales/{sale_id}/document")
def download_factus_document(sale_id: int, db_session: Session = Depends(db.get_db)):
    settings = FactusSettings.from_env()
    sale = _sale_or_404(db_session, sale_id)
    if not sale.electronic_invoice or not sale.electronic_invoice.factus_bill_number:
        raise HTTPException(status_code=404, detail="La venta no tiene factura emitida")

    bill_number = sale.electronic_invoice.factus_bill_number
    try:
        filename, pdf_bytes = download_bill_pdf(settings=settings, bill_number=bill_number)
    except FactusConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FactusTransportError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except FactusApiError as exc:
        status_code = exc.status_code if 400 <= exc.status_code < 500 else 502
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    safe_filename = filename.replace('"', "")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.post("/sales/{sale_id}/send-email", response_model=schemas.ElectronicInvoiceOut)
def resend_factus_email(
    sale_id: int,
    payload: schemas.FactusEmailSendRequest,
    db_session: Session = Depends(db.get_db),
):
    settings = FactusSettings.from_env()
    sale = _sale_or_404(db_session, sale_id)
    invoice = sale.electronic_invoice
    if not invoice or not invoice.factus_bill_number:
        raise HTTPException(status_code=404, detail="La venta no tiene factura emitida")

    email = payload.email.strip()
    try:
        send_response = send_bill_email(
            settings=settings,
            bill_number=invoice.factus_bill_number,
            email=email,
            bill_id=invoice.factus_bill_id,
        )
        response_payload = (
            dict(invoice.response_payload) if isinstance(invoice.response_payload, dict) else {}
        )
        response_payload["email_delivery"] = {
            "requested": True,
            "email": email,
            "ok": True,
            "response": send_response,
        }
        invoice.response_payload = response_payload
        invoice.error_message = None
        db_session.add(invoice)
        db_session.commit()
        db_session.refresh(invoice)
        return _electronic_invoice_out(invoice)
    except FactusConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FactusTransportError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except FactusApiError as exc:
        response_payload = (
            dict(invoice.response_payload) if isinstance(invoice.response_payload, dict) else {}
        )
        response_payload["email_delivery"] = {
            "requested": True,
            "email": email,
            "ok": False,
            "error": str(exc),
        }
        invoice.response_payload = response_payload
        db_session.add(invoice)
        db_session.commit()
        db_session.refresh(invoice)
        if exc.status_code == 404:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Factus no permite reenviar correo para esta factura en este entorno. "
                    "El envio principal se solicita al emitir la factura (send_email=true)."
                ),
            ) from exc
        status_code = exc.status_code if 400 <= exc.status_code < 500 else 502
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.post("/sales/{sale_id}/credit-note", response_model=schemas.ElectronicInvoiceOut)
def create_factus_credit_note(
    sale_id: int,
    payload: schemas.FactusCreditNoteRequest | None = None,
    db_session: Session = Depends(db.get_db),
):
    """
    Anula una factura electrónica ya validada mediante nota crédito en Factus
    (POST /v1/credit-notes/validate — concepto 2 anulación, tipo 20 con referencia a factura).
    """
    settings = FactusSettings.from_env()
    sale = _sale_or_404(db_session, sale_id)
    invoice = sale.electronic_invoice
    if not invoice:
        raise HTTPException(status_code=404, detail="La venta no tiene factura electronica registrada")
    if invoice.status == "voided":
        raise HTTPException(
            status_code=409,
            detail="Esta venta ya tiene nota credito registrada (anulacion).",
        )
    if invoice.status != "issued":
        raise HTTPException(
            status_code=400,
            detail=f"Solo se anulan facturas emitidas (issued). Estado actual: {invoice.status}",
        )
    if not invoice.factus_bill_id:
        raise HTTPException(
            status_code=400,
            detail="No hay bill_id de Factus; no se puede crear nota credito desde esta venta.",
        )

    body = payload or schemas.FactusCreditNoteRequest()
    try:
        cn_payload = build_credit_note_void_invoice_payload(
            settings=settings,
            sale=sale,
            invoice=invoice,
            numbering_range_id=body.numbering_range_id,
            observation=body.observation,
            send_email=body.send_email,
        )
        cn_response = create_credit_note_validate(settings, cn_payload)
        merged: dict = dict(invoice.response_payload) if isinstance(invoice.response_payload, dict) else {}
        merged["credit_note"] = cn_response
        invoice.response_payload = merged
        invoice.status = "voided"
        invoice.error_message = None
        db_session.add(invoice)
        db_session.commit()
        db_session.refresh(invoice)
        return _electronic_invoice_out(invoice)
    except FactusConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FactusTransportError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except FactusApiError as exc:
        status_code = exc.status_code if 400 <= exc.status_code < 500 else 502
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
