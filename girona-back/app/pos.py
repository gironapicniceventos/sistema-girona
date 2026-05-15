from __future__ import annotations

import base64
import logging
import os
import re
import subprocess
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from . import db, models, schemas
from .inventory import apply_pos_order_inventory_consumption

router = APIRouter(prefix="/pos", tags=["pos"])
logger = logging.getLogger("uvicorn.error")

INC_RATE = Decimal("0.08")


BAR_CATEGORY_KEYS = {
    "bebidas",
    "malteadas",
    "dulces bar",
    "sodas",
    "gaseosas",
    "para el almuerzo",
    "cervezas nacionales",
    "cervezas internacionales",
    "micheladas",
    "licores y shots",
    "cubetazos",
    "cocteleria",
    "vinos",
}

# Toma de pedidos: zona según número de mesa (1–73 y posteriores en ROUSSE).
POS_TABLE_SECTIONS = (
    "ENTRADA",
    "LOBBY",
    "TERRAZA 1",
    "TERRAZA 2",
    "PREMIUM",
    "ROUSSE",
)


def _norm(value: str) -> str:
    return value.strip().lower()


def parse_pos_table_number(name: str) -> int | None:
    s = (name or "").strip()
    if not s:
        return None
    if re.fullmatch(r"\d+", s):
        return int(s)
    m = re.search(r"(\d+)", s)
    if m:
        return int(m.group(1))
    return None


def section_for_pos_table_number(n: int) -> str:
    if n < 1:
        return "ENTRADA"
    if n <= 10:
        return "ENTRADA"
    if n <= 29:
        return "LOBBY"
    if n <= 39:
        return "TERRAZA 1"
    if n <= 49:
        return "TERRAZA 2"
    if n <= 59:
        return "PREMIUM"
    return "ROUSSE"


def resync_pos_table_sections(db_session: Session) -> bool:
    """Alinea `section` con el número en el nombre (p. ej. '12', 'Mesa 30')."""
    dirty = False
    rows = (
        db_session.query(models.PosTable)
        .filter(models.PosTable.is_active == True)  # noqa: E712
        .all()
    )
    for t in rows:
        n = parse_pos_table_number(t.name)
        if n is None:
            continue
        want = section_for_pos_table_number(n)
        if t.section != want:
            t.section = want
            dirty = True
    return dirty


def _normalize_table_section(raw_section: str | None) -> str:
    section = (raw_section or "").strip().upper()
    if not section:
        return "ENTRADA"
    valid_sections = {value.upper(): value for value in POS_TABLE_SECTIONS}
    if section not in valid_sections:
        raise HTTPException(
            status_code=400,
            detail=f"Seccion invalida. Usa: {', '.join(POS_TABLE_SECTIONS)}",
        )
    return valid_sections[section]


def _table_or_404(db_session: Session, table_id: int) -> models.PosTable:
    table = (
        db_session.query(models.PosTable)
        .filter(models.PosTable.id == table_id, models.PosTable.is_active == True)  # noqa: E712
        .first()
    )
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return table


def _menu_item_or_404(db_session: Session, menu_item_id: int) -> models.MenuItem:
    item = (
        db_session.query(models.MenuItem)
        .filter(models.MenuItem.id == menu_item_id, models.MenuItem.is_active == True)  # noqa: E712
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=f"Menu item {menu_item_id} no encontrado")
    return item


def _compute_order_totals(
    items: list[models.PosOrderItem], service_total: Decimal, utility_total: Decimal
):
    subtotal = sum((i.line_subtotal for i in items), Decimal("0"))
    tax_total = sum((i.line_tax for i in items), Decimal("0"))
    total = subtotal + tax_total + service_total + utility_total
    discount_total = sum((i.discount_amount for i in items), Decimal("0"))
    courtesy_total = sum((i.unit_price * i.quantity for i in items if i.courtesy), Decimal("0"))
    return subtotal, tax_total, discount_total, courtesy_total, total


def _compute_line_amounts(
    quantity: Decimal,
    unit_price: Decimal,
    discount_amount: Decimal,
    tax_rate: Decimal,
) -> tuple[Decimal, Decimal, Decimal]:
    price_before_discount = unit_price * quantity
    line_subtotal = max(price_before_discount - discount_amount, Decimal("0"))
    line_tax = line_subtotal * tax_rate
    return line_subtotal, line_tax, line_subtotal + line_tax


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _format_quantity(value: Decimal) -> str:
    qty = Decimal(value)
    if qty == qty.to_integral_value():
        return str(int(qty))
    normalized = f"{qty.normalize():f}"
    return normalized.rstrip("0").rstrip(".")


def _build_ticket_text(
    *,
    order_id: int,
    table_name: str,
    zone_label: str,
    created_at: datetime,
    items: list[models.PosOrderItem],
) -> str:
    created_local = created_at.astimezone().strftime("%Y-%m-%d %H:%M")
    lines = [
        "GIRONA POS",
        f"COMANDA #{order_id}",
        f"MESA: {table_name}",
        f"ZONA: {zone_label}",
        f"FECHA: {created_local}",
        "-" * 40,
    ]

    for item in items:
        qty_text = _format_quantity(Decimal(item.quantity))
        item_name = (item.name or "").strip()
        lines.append(f"{qty_text} x {item_name}")
        note = (item.note or "").strip()
        if note:
            lines.append(f"  Nota: {note}")

    lines.append("-" * 40)
    lines.append("")
    return "\n".join(lines)


def _send_text_to_windows_printer(*, text: str, printer_hint: str, copies: int) -> None:
    if os.name != "nt":
        raise RuntimeError("Impresion automatica disponible solo en Windows")

    encoded_text = base64.b64encode(text.encode("utf-8")).decode("ascii")
    safe_hint = printer_hint.replace("'", "''")
    safe_copies = max(1, min(copies, 5))

    ps_command = (
        f"$printerHint='{safe_hint}';"
        "$printer=Get-Printer | Where-Object { "
        "$_.Name -eq $printerHint -or "
        "$_.Name -like ('*' + $printerHint + '*') -or "
        "$_.PortName -eq $printerHint -or "
        "$_.PortName -like ('*' + $printerHint + '*') "
        "} | Select-Object -First 1;"
        "if(-not $printer){ "
        "$available=(Get-Printer | Select-Object -ExpandProperty Name) -join ', ';"
        "throw \"No se encontro impresora: $printerHint. Disponibles: $available\" "
        "};"
        f"$text=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded_text}'));"
        f"for($i=0; $i -lt {safe_copies}; $i++){{ $text | Out-Printer -Name $printer.Name }}"
    )

    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps_command],
        capture_output=True,
        text=True,
        timeout=20,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(stderr or "Error desconocido al enviar impresion")


def _auto_print_comanda(
    *,
    order_id: int,
    table_name: str,
    created_at: datetime,
    items: list[models.PosOrderItem],
) -> None:
    if not _env_bool("POS_AUTO_PRINT_COMANDA", default=False):
        return

    printer_hint = (os.getenv("POS_COMANDA_PRINTER") or "M2020").strip()
    if not printer_hint:
        logger.warning("POS_AUTO_PRINT_COMANDA activo pero POS_COMANDA_PRINTER vacio")
        return

    split_by_zone = _env_bool("POS_COMANDA_SPLIT_BY_ZONE", default=True)
    copies_raw = (os.getenv("POS_COMANDA_COPIES") or "1").strip()
    try:
        copies = int(copies_raw)
    except ValueError:
        copies = 1

    if split_by_zone:
        zones: list[tuple[str, list[models.PosOrderItem]]] = [
            ("COCINA", [i for i in items if str(i.zone).lower() != "bar"]),
            ("BAR", [i for i in items if str(i.zone).lower() == "bar"]),
        ]
    else:
        zones = [("GENERAL", list(items))]

    for zone_label, zone_items in zones:
        if not zone_items:
            continue
        ticket_text = _build_ticket_text(
            order_id=order_id,
            table_name=table_name,
            zone_label=zone_label,
            created_at=created_at,
            items=zone_items,
        )
        try:
            _send_text_to_windows_printer(text=ticket_text, printer_hint=printer_hint, copies=copies)
            logger.info(
                "Comanda #%s enviada a impresora '%s' (zona=%s, items=%s)",
                order_id,
                printer_hint,
                zone_label,
                len(zone_items),
            )
        except Exception as exc:
            logger.warning(
                "No se pudo imprimir comanda #%s en '%s' (zona=%s): %s",
                order_id,
                printer_hint,
                zone_label,
                exc,
            )


def _recompute_order_for_close(order: models.PosOrder, apply_inc: bool) -> None:
    effective_tax_rate = INC_RATE if apply_inc else Decimal("0")
    items = list(order.items)

    for item in items:
        if item.courtesy:
            item.tax_rate = Decimal("0")
            item.line_subtotal = Decimal("0")
            item.line_tax = Decimal("0")
            item.line_total = Decimal("0")
            continue

        line_subtotal, line_tax, line_total = _compute_line_amounts(
            quantity=Decimal(item.quantity),
            unit_price=Decimal(item.unit_price),
            discount_amount=Decimal(item.discount_amount),
            tax_rate=effective_tax_rate,
        )
        item.tax_rate = effective_tax_rate
        item.line_subtotal = line_subtotal
        item.line_tax = line_tax
        item.line_total = line_total

    subtotal, tax_total, discount_total, courtesy_total, total = _compute_order_totals(
        items, Decimal(order.service_total), Decimal(order.utility_total)
    )
    order.subtotal = subtotal
    order.tax_total = tax_total
    order.discount_total = discount_total
    order.courtesy_total = courtesy_total
    order.total = total


_ALLOWED_PAYMENT_METHODS = frozenset(
    {
        "efectivo",
        "datofono",
        "qr",
        "nequi",
        "tarjeta",
        "tarjeta_credito",
        "tarjeta_debito",
        "transferencia",
        "billetera",
        "otro",
    },
)


def _normalize_payment_method(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    v = str(value).strip().lower()
    if v not in _ALLOWED_PAYMENT_METHODS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Medio de pago invalido. Usa: efectivo, datofono, qr, nequi; "
                "o valores heredados: tarjeta_credito, tarjeta_debito, transferencia, "
                "billetera, otro (o tarjeta en registros anteriores)"
            ),
        )
    return v


def _create_sale_from_order(
    db_session: Session,
    order: models.PosOrder,
    customer_id: int | None = None,
    waiter_id: int | None = None,
    payment_method: str | None = None,
) -> models.Sale:
    if order.sale:
        if customer_id is not None:
            order.sale.customer_id = customer_id
        if waiter_id is not None:
            order.sale.waiter_id = waiter_id
        if payment_method is not None:
            order.sale.payment_method = payment_method
        return order.sale

    sale_subtotal = Decimal("0")
    sale_tax_total = Decimal("0")
    sale_items_payload: list[dict[str, Decimal | int | str]] = []
    for item in order.items:
        line_subtotal, line_tax, line_total = _compute_line_amounts(
            quantity=Decimal(item.quantity),
            unit_price=Decimal(item.unit_price),
            discount_amount=Decimal(item.discount_amount),
            tax_rate=Decimal(item.tax_rate),
        )
        sale_subtotal += line_subtotal
        sale_tax_total += line_tax
        sale_items_payload.append(
            {
                "menu_item_id": item.menu_item_id,
                "name": item.name,
                "category": item.category,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "tax_rate": item.tax_rate,
                "line_subtotal": line_subtotal,
                "line_tax": line_tax,
                "line_total": line_total,
            }
        )

    sale = models.Sale(
        order_id=order.id,
        customer_id=customer_id,
        waiter_id=waiter_id,
        subtotal=sale_subtotal,
        tax_total=sale_tax_total,
        discount_total=order.discount_total,
        courtesy_total=order.courtesy_total,
        service_total=order.service_total,
        utility_total=order.utility_total,
        total=sale_subtotal
        + sale_tax_total
        + Decimal(order.service_total)
        + Decimal(order.utility_total),
        payment_method=payment_method,
    )
    db_session.add(sale)
    db_session.flush()

    for payload in sale_items_payload:
        sale_item = models.SaleItem(
            sale_id=sale.id,
            menu_item_id=int(payload["menu_item_id"]),
            name=str(payload["name"]),
            category=str(payload["category"]),
            quantity=Decimal(payload["quantity"]),
            unit_price=Decimal(payload["unit_price"]),
            tax_rate=Decimal(payload["tax_rate"]),
            line_subtotal=Decimal(payload["line_subtotal"]),
            line_tax=Decimal(payload["line_tax"]),
            line_total=Decimal(payload["line_total"]),
        )
        db_session.add(sale_item)

    return sale


@router.post("/tables", response_model=schemas.PosTableOut, status_code=201)
def create_table(payload: schemas.PosTableCreate, db_session: Session = Depends(db.get_db)):
    name = payload.name.strip()
    n = parse_pos_table_number(name)
    if n is not None:
        section = section_for_pos_table_number(n)
    else:
        section = _normalize_table_section(payload.section)
    existing = (
        db_session.query(models.PosTable)
        .filter(models.PosTable.is_active == True, models.PosTable.name == name)  # noqa: E712
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="La mesa ya existe")
    table = models.PosTable(name=name, section=section)
    db_session.add(table)
    db_session.commit()
    db_session.refresh(table)
    return table


@router.get("/tables", response_model=list[schemas.PosTableOut])
def list_tables(db_session: Session = Depends(db.get_db)):
    if resync_pos_table_sections(db_session):
        db_session.commit()
    return (
        db_session.query(models.PosTable)
        .filter(models.PosTable.is_active == True)  # noqa: E712
        .order_by(models.PosTable.id.asc())
        .all()
    )


@router.delete("/tables/{table_id}", status_code=204)
def delete_table(table_id: int, db_session: Session = Depends(db.get_db)):
    table = db_session.query(models.PosTable).filter(models.PosTable.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")

    table.is_active = False
    db_session.add(table)
    db_session.commit()
    return None


@router.post("/orders", response_model=schemas.PosOrderOut, status_code=201)
def create_order(payload: schemas.PosOrderCreate, db_session: Session = Depends(db.get_db)):
    table = _table_or_404(db_session, payload.table_id)

    waiter_id: int | None = None
    if payload.waiter_id is not None:
        waiter = (
            db_session.query(models.Waiter)
            .filter(models.Waiter.id == payload.waiter_id, models.Waiter.is_active == True)  # noqa: E712
            .first()
        )
        if not waiter:
            raise HTTPException(status_code=404, detail="Mesero no encontrado")
        waiter_id = waiter.id

    order = models.PosOrder(
        table_id=table.id,
        status="open",
        service_total=payload.service_total,
        waiter_id=waiter_id,
    )
    db_session.add(order)
    db_session.flush()

    items: list[models.PosOrderItem] = []
    now = datetime.now(timezone.utc)

    for item_payload in payload.items:
        menu_item = _menu_item_or_404(db_session, item_payload.menu_item_id)
        zone = "bar" if _norm(menu_item.category) in BAR_CATEGORY_KEYS else "kitchen"

        qty = Decimal(item_payload.quantity)
        unit_price = Decimal(item_payload.unit_price)
        discount_amount = Decimal(item_payload.discount_amount)
        tax_rate = Decimal("0")

        if discount_amount < 0:
            raise HTTPException(status_code=400, detail="Descuento inválido")

        if item_payload.courtesy:
            line_subtotal = Decimal("0")
            line_tax = Decimal("0")
            line_total = Decimal("0")
        else:
            line_subtotal, line_tax, line_total = _compute_line_amounts(
                quantity=qty,
                unit_price=unit_price,
                discount_amount=discount_amount,
                tax_rate=tax_rate,
            )

        pos_item = models.PosOrderItem(
            order_id=order.id,
            menu_item_id=menu_item.id,
            name=menu_item.name,
            category=menu_item.category,
            zone=zone,
            quantity=qty,
            unit_price=unit_price,
            tax_rate=tax_rate,
            discount_amount=discount_amount,
            courtesy=item_payload.courtesy,
            note=item_payload.note,
            line_subtotal=line_subtotal,
            line_tax=line_tax,
            line_total=line_total,
            sent_at=now,
        )
        items.append(pos_item)
        db_session.add(pos_item)

    subtotal, tax_total, discount_total, courtesy_total, total = _compute_order_totals(
        items, payload.service_total, Decimal(order.utility_total)
    )
    order.subtotal = subtotal
    order.tax_total = tax_total
    order.discount_total = discount_total
    order.courtesy_total = courtesy_total
    order.total = total
    order.sent_at = now

    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)
    _auto_print_comanda(
        order_id=order.id,
        table_name=table.name,
        created_at=now,
        items=items,
    )
    return order


@router.get("/orders", response_model=list[schemas.PosOrderOut])
def list_orders(db_session: Session = Depends(db.get_db)):
    return (
        db_session.query(models.PosOrder)
        .options(
            joinedload(models.PosOrder.waiter),
            joinedload(models.PosOrder.sale),
        )
        .order_by(models.PosOrder.id.desc())
        .limit(200)
        .all()
    )


@router.delete("/orders/finished")
def clear_finished_orders(db_session: Session = Depends(db.get_db)):
    cleared = (
        db_session.query(func.count(models.PosOrder.id))
        .filter(models.PosOrder.status.in_(["closed", "void"]))
        .scalar()
        or 0
    )
    return {"cleared": int(cleared)}


@router.get("/orders/{order_id}", response_model=schemas.PosOrderOut)
def get_order(order_id: int, db_session: Session = Depends(db.get_db)):
    order = (
        db_session.query(models.PosOrder)
        .options(
            joinedload(models.PosOrder.waiter),
            joinedload(models.PosOrder.sale),
        )
        .filter(models.PosOrder.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return order


@router.post("/orders/{order_id}/items", response_model=schemas.PosOrderOut)
def append_items_to_order(
    order_id: int,
    payload: schemas.PosOrderAppendItems,
    db_session: Session = Depends(db.get_db),
):
    order = db_session.query(models.PosOrder).filter(models.PosOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.status in {"closed", "void"}:
        raise HTTPException(status_code=400, detail="La orden ya está finalizada")

    now = datetime.now(timezone.utc)
    existing_items = list(order.items)
    new_items: list[models.PosOrderItem] = []

    for item_payload in payload.items:
        menu_item = _menu_item_or_404(db_session, item_payload.menu_item_id)
        zone = "bar" if _norm(menu_item.category) in BAR_CATEGORY_KEYS else "kitchen"

        qty = Decimal(item_payload.quantity)
        unit_price = Decimal(item_payload.unit_price)
        tax_rate = Decimal("0")
        line_base = unit_price * qty
        discount_amount = min(max(Decimal(item_payload.discount_amount), Decimal("0")), line_base)

        if item_payload.courtesy:
            line_subtotal = Decimal("0")
            line_tax = Decimal("0")
            line_total = Decimal("0")
        else:
            line_subtotal, line_tax, line_total = _compute_line_amounts(
                quantity=qty,
                unit_price=unit_price,
                discount_amount=discount_amount,
                tax_rate=tax_rate,
            )

        pos_item = models.PosOrderItem(
            order_id=order.id,
            menu_item_id=menu_item.id,
            name=menu_item.name,
            category=menu_item.category,
            zone=zone,
            quantity=qty,
            unit_price=unit_price,
            tax_rate=tax_rate,
            discount_amount=discount_amount,
            courtesy=item_payload.courtesy,
            note=item_payload.note,
            line_subtotal=line_subtotal,
            line_tax=line_tax,
            line_total=line_total,
            sent_at=now,
        )
        db_session.add(pos_item)
        new_items.append(pos_item)

    subtotal, tax_total, discount_total, courtesy_total, total = _compute_order_totals(
        existing_items + new_items,
        Decimal(order.service_total),
        Decimal(order.utility_total),
    )
    order.subtotal = subtotal
    order.tax_total = tax_total
    order.discount_total = discount_total
    order.courtesy_total = courtesy_total
    order.total = total
    order.sent_at = now
    if order.status == "delivered":
        order.status = "sent"
        order.delivered_at = None

    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)
    _auto_print_comanda(
        order_id=order.id,
        table_name=order.table.name if order.table else f"Mesa {order.table_id}",
        created_at=now,
        items=new_items,
    )
    return order


@router.delete("/orders/{order_id}/items/{item_id}", response_model=schemas.PosOrderOut)
def delete_order_item(
    order_id: int,
    item_id: int,
    db_session: Session = Depends(db.get_db),
):
    order = db_session.query(models.PosOrder).filter(models.PosOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.status in {"closed", "void"}:
        raise HTTPException(status_code=400, detail="La orden ya está finalizada")

    item = (
        db_session.query(models.PosOrderItem)
        .filter(models.PosOrderItem.id == item_id, models.PosOrderItem.order_id == order.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item no encontrado en la orden")

    db_session.delete(item)
    db_session.flush()

    remaining_items = list(order.items)
    subtotal, tax_total, discount_total, courtesy_total, total = _compute_order_totals(
        remaining_items,
        Decimal(order.service_total),
        Decimal(order.utility_total),
    )
    order.subtotal = subtotal
    order.tax_total = tax_total
    order.discount_total = discount_total
    order.courtesy_total = courtesy_total
    order.total = total
    if order.status == "delivered":
        order.status = "sent"
        order.delivered_at = None

    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)
    return order


@router.post("/orders/{order_id}/deliver", response_model=schemas.PosOrderOut)
def mark_order_delivered(
    order_id: int, payload: schemas.PosOrderDeliver, db_session: Session = Depends(db.get_db)
):
    order = db_session.query(models.PosOrder).filter(models.PosOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")

    if payload.delivered:
        waiter_id = payload.waiter_id
        if order.waiter_id is None and waiter_id is not None:
            waiter = (
                db_session.query(models.Waiter)
                .filter(models.Waiter.id == waiter_id, models.Waiter.is_active == True)  # noqa: E712
                .first()
            )
            if not waiter:
                raise HTTPException(status_code=404, detail="Mesero no encontrado")
            order.waiter_id = waiter.id
        now = datetime.now(timezone.utc)
        order.delivered_at = now
        order.status = "delivered"
        for item in order.items:
            item.delivered_at = item.delivered_at or now
    else:
        order.delivered_at = None
        order.status = "sent"
        for item in order.items:
            item.delivered_at = None

    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)
    return order


@router.post("/orders/{order_id}/close", response_model=schemas.PosOrderOut)
def mark_order_closed(
    order_id: int,
    payload: schemas.PosOrderClose | None = None,
    db_session: Session = Depends(db.get_db),
):
    order = db_session.query(models.PosOrder).filter(models.PosOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.status == "closed":
        raise HTTPException(status_code=409, detail="La orden ya esta cerrada")
    if order.status == "void":
        raise HTTPException(status_code=409, detail="La orden esta anulada")

    customer_id = None
    if payload is not None:
        if payload.customer_id is not None:
            customer = (
                db_session.query(models.Customer)
                .filter(models.Customer.id == payload.customer_id)
                .first()
            )
            if not customer:
                raise HTTPException(status_code=404, detail="Cliente no encontrado")
            customer_id = customer.id
        else:
            name = (payload.customer_name or "").strip()
            identity_document = (payload.customer_identity_document or "").strip()
            if name or identity_document:
                if not name or not identity_document:
                    raise HTTPException(
                        status_code=400, detail="Nombre y documento son requeridos"
                    )
                existing = (
                    db_session.query(models.Customer)
                    .filter(func.lower(models.Customer.identity_document) == _norm(identity_document))
                    .first()
                )
                if existing:
                    customer_id = existing.id
                else:
                    phone = payload.customer_phone.strip() if payload.customer_phone else None
                    customer = models.Customer(
                        name=name,
                        identity_document=identity_document,
                        phone=phone or None,
                        is_active=True,
                    )
                    db_session.add(customer)
                    db_session.flush()
                    customer_id = customer.id

    if payload is not None and payload.service_total is not None:
        order.service_total = Decimal(payload.service_total)
    if payload is not None and payload.utility_total is not None:
        order.utility_total = Decimal(payload.utility_total)

    apply_inc = bool(payload.apply_inc) if payload is not None else False
    _recompute_order_for_close(order, apply_inc=apply_inc)

    now = datetime.now(timezone.utc)
    order.closed_at = now
    order.status = "closed"

    payment_method: str | None = None
    if payload is not None and payload.payment_method is not None:
        payment_method = _normalize_payment_method(payload.payment_method)

    sale = _create_sale_from_order(
        db_session,
        order,
        customer_id=customer_id,
        waiter_id=order.waiter_id,
        payment_method=payment_method,
    )
    apply_pos_order_inventory_consumption(db_session, order, sale.id)
    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)
    return order


@router.post("/orders/{order_id}/void", response_model=schemas.PosOrderOut)
def mark_order_void(order_id: int, db_session: Session = Depends(db.get_db)):
    order = db_session.query(models.PosOrder).filter(models.PosOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")

    now = datetime.now(timezone.utc)
    order.status = "void"
    order.closed_at = now

    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)
    return order
