"""
Marca facturas electrónicas como voided cuando la nota crédito ya se emitió fuera de
Girona (p. ej. Factus / otro cliente). Actualiza response_payload con la misma forma
que create_factus_credit_note para que factus_credit_note_number y la UI cuadren.

Uso (desde girona-back, con DATABASE_URL en el entorno o .env cargado):

  python -m app.reconcile_external_credit_notes

  # Solo simular:
  python -m app.reconcile_external_credit_notes --dry-run

Con Docker (ajusta host/puerto según tu .env):

  docker compose exec backend python -m app.reconcile_external_credit_notes
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from . import db, models


# Facturas ya anuladas ante la DIAN con NC generada fuera de este flujo.
# Añade aquí pares factura NC; el script solo actualiza filas con status "issued".
DEFAULT_RECONCILIATIONS: list[dict[str, str | int | None]] = [
    {
        "factus_bill_number": "FG1",
        "credit_note_number": "NC1",
        "credit_note_id": None,
        "cude_credit_note": "d96720915cb94541f92a58f9a967eacbe12ae1549941a5bcd4752cedda1e58585ac07a8b1535d78398736f4e20740596",
        "pdf_filename": "nc09020497300002600000001.pdf",
    },
    {
        "factus_bill_number": "FG2",
        "credit_note_number": "NC2",
        "credit_note_id": None,
        "cude_credit_note": "3b4b5194432ad7cd4717a8c4e4b84c54670c77ac4d5e3cf1b52ad247da98d48e2fd754149a4ef5aee412a91f31d9d102",
        "pdf_filename": "nc09020497300002600000002.pdf",
    },
]


def _stub_credit_note_response(
    *,
    credit_note_number: str,
    credit_note_id: int | None,
    extra: dict[str, str | int | None] | None = None,
) -> dict:
    inner: dict = {"number": str(credit_note_number)}
    if credit_note_id is not None:
        inner["id"] = int(credit_note_id)
    out: dict = {"data": {"credit_note": inner}}
    if extra:
        out["reconciled_externally"] = True
        out["reconciliation"] = {k: v for k, v in extra.items() if v is not None}
    return out


def reconcile_one(
    session: Session,
    row: dict[str, str | int | None],
    *,
    dry_run: bool,
) -> str:
    bill = str(row["factus_bill_number"]).strip()
    cn_num = str(row["credit_note_number"]).strip()
    cn_id = row.get("credit_note_id")
    cn_id_int: int | None = int(cn_id) if cn_id is not None and str(cn_id).strip() != "" else None

    inv = (
        session.query(models.ElectronicInvoice)
        .filter(models.ElectronicInvoice.factus_bill_number == bill)
        .one_or_none()
    )
    if inv is None:
        return f"OMITIDO: no hay electronic_invoices con factus_bill_number={bill!r}"

    if inv.status == "voided":
        return f"OMITIDO: {bill} ya estaba voided (id invoice={inv.id})"

    if inv.status != "issued":
        return (
            f"OMITIDO: {bill} estado {inv.status!r} (solo se reconcilian emitidas issued; "
            f"invoice id={inv.id})"
        )

    base = dict(inv.response_payload) if isinstance(inv.response_payload, dict) else {}
    merge_extra = {
        "at": datetime.now(timezone.utc).isoformat(),
        "reason": "Nota crédito emitida fuera del botón Girona; alineación manual en BD.",
        "factus_bill_number": bill,
        "credit_note_number_display": cn_num,
        "pdf_filename": row.get("pdf_filename"),
        "cude_credit_note": row.get("cude_credit_note"),
    }
    stub = _stub_credit_note_response(
        credit_note_number=cn_num,
        credit_note_id=cn_id_int,
        extra=merge_extra,
    )
    merged = dict(base)
    merged["credit_note"] = stub
    merged["external_credit_note_reconciliation"] = merge_extra

    if dry_run:
        return (
            f"DRY-RUN: actualizaría invoice id={inv.id} sale_id={inv.sale_id} {bill!r} → "
            f"voided + NC {cn_num!r}; payload keys: {sorted(merged.keys())}"
        )

    inv.response_payload = merged
    inv.status = "voided"
    inv.error_message = None
    session.add(inv)
    session.flush()
    return f"OK: invoice id={inv.id} sale_id={inv.sale_id} {bill!r} → voided, NC {cn_num!r}"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Reconciliar NC emitidas fuera de Girona.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No escribe en la base; solo muestra qué haría.",
    )
    args = parser.parse_args(argv)

    lines: list[str] = []
    session = db.SessionLocal()
    try:
        for row in DEFAULT_RECONCILIATIONS:
            msg = reconcile_one(session, row, dry_run=args.dry_run)
            lines.append(msg)
        if not args.dry_run:
            session.commit()
        for line in lines:
            print(line)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
