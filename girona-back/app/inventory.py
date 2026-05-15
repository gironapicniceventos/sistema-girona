from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import case, exists, func
from sqlalchemy.orm import Session, joinedload

from . import db, models, schemas, withholding_co

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _norm(value: str) -> str:
    return value.strip().lower()


def _get_product(db_session: Session, product_id: int) -> models.InventoryProduct:
    product = (
        db_session.query(models.InventoryProduct)
        .filter(models.InventoryProduct.id == product_id)
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return product


def _find_product_by_name(
    db_session: Session, *, name: str, exclude_id: int | None = None
) -> models.InventoryProduct | None:
    query = db_session.query(models.InventoryProduct).filter(
        func.lower(models.InventoryProduct.name) == _norm(name)
    )
    if exclude_id is not None:
        query = query.filter(models.InventoryProduct.id != exclude_id)
    return query.first()


def _inventory_unit_to_recipe_abbr(unit: str | None) -> str | None:
    if unit is None:
        return None
    u = unit.strip().lower()
    if not u:
        return None
    if "gramo" in u or u in {"gr", "g"}:
        return "GR"
    if "mililit" in u or u in {"ml"}:
        return "ML"
    if "unidad" in u:
        return "UND"
    return None


def _catalog_ingredients_from_line_items(recipe: models.Recipe) -> list[schemas.RecipeIngredientOut]:
    out: list[schemas.RecipeIngredientOut] = []
    for ri in recipe.items:
        if ri.product is None:
            continue
        p = ri.product
        out.append(
            schemas.RecipeIngredientOut(
                name=p.name,
                unit=_inventory_unit_to_recipe_abbr(p.unit),
                quantity=ri.quantity,
                product_id=p.id,
            )
        )
    return out


def _sync_recipe_line_items(
    db_session: Session,
    recipe: models.Recipe,
    ingredients: list[schemas.RecipeIngredientCreate],
) -> None:
    line_items: list[models.RecipeItem] = []
    for ingredient in ingredients:
        item_name = ingredient.name.strip()
        if not item_name:
            raise HTTPException(status_code=400, detail="Ingrediente inválido")

        product: models.InventoryProduct | None = None
        if ingredient.product_id is not None:
            product = _get_product(db_session, ingredient.product_id)
        else:
            product = _find_product_by_name(db_session, name=item_name)

        if not product:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No hay producto de inventario para «{item_name}». "
                    "Elegí el ingrediente en el buscador o creá el producto en Inventario."
                ),
            )

        line_items.append(
            models.RecipeItem(
                product_id=product.id,
                quantity=ingredient.quantity,
                waste_pct=ingredient.waste_pct,
            )
        )
    recipe.items = line_items


def _find_product_by_sku(
    db_session: Session, *, sku: str, exclude_id: int | None = None
) -> models.InventoryProduct | None:
    query = db_session.query(models.InventoryProduct).filter(
        func.lower(models.InventoryProduct.sku) == _norm(sku)
    )
    if exclude_id is not None:
        query = query.filter(models.InventoryProduct.id != exclude_id)
    return query.first()


def _as_decimal(value: Decimal | int | str) -> Decimal:
    if isinstance(value, Decimal):
        return value

    raw = str(value).strip()
    if not raw:
        return Decimal("0")

    raw = raw.replace(" ", "")

    def _looks_like_thousands_sep(s: str, sep: str) -> bool:
        parts = s.split(sep)
        if len(parts) <= 1:
            return False
        if not all(part.isdigit() for part in parts):
            return False
        return len(parts[0]) in (1, 2, 3) and all(len(part) == 3 for part in parts[1:])

    if "." in raw and "," in raw:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif "." in raw:
        if _looks_like_thousands_sep(raw, "."):
            raw = raw.replace(".", "")
    elif "," in raw:
        if _looks_like_thousands_sep(raw, ","):
            raw = raw.replace(",", "")
        else:
            raw = raw.replace(",", ".")

    return Decimal(raw)


def _purchase_line_amounts(
    qty: Decimal, unit_cost: Decimal, iva_rate: Decimal
) -> tuple[Decimal, Decimal, Decimal]:
    line_net = (qty * unit_cost).quantize(Decimal("1"))
    rate = max(Decimal("0"), min(Decimal("1"), iva_rate))
    line_iva = (line_net * rate).quantize(Decimal("1"))
    line_gross = (line_net + line_iva).quantize(Decimal("1"))
    return line_net, line_iva, line_gross


def _purchase_item_iva_rate(item: schemas.PurchaseItemCreate) -> Decimal:
    if item.iva_rate is None:
        return Decimal("0")
    return max(Decimal("0"), min(Decimal("1"), _as_decimal(item.iva_rate)))


@router.get("/products", response_model=list[schemas.InventoryProductOut])
def list_products(
    active: bool | None = True,
    kind: schemas.InventoryProductKind | None = None,
    sort: str | None = None,
    db_session: Session = Depends(db.get_db),
):
    query = db_session.query(models.InventoryProduct)
    if active is not None:
        query = query.filter(models.InventoryProduct.is_active == active)
    if kind is not None:
        query = query.filter(models.InventoryProduct.kind == kind.value)
    if sort == "supplier_linked":
        linked = exists().where(
            models.SupplierIngredient.product_id == models.InventoryProduct.id
        )
        query = query.order_by(
            case((linked, 0), else_=1),
            models.InventoryProduct.name.asc(),
        )
    else:
        query = query.order_by(models.InventoryProduct.name.asc())
    return query.all()


@router.post("/products", response_model=schemas.InventoryProductOut, status_code=201)
def create_product(
    payload: schemas.InventoryProductCreate, db_session: Session = Depends(db.get_db)
):
    name = payload.name.strip()
    existing = _find_product_by_name(db_session, name=name)

    sku = payload.sku.strip() if payload.sku else None
    if sku and _find_product_by_sku(db_session, sku=sku, exclude_id=existing.id if existing else None):
        raise HTTPException(status_code=409, detail="Ya existe un producto con ese SKU")

    kind = payload.kind.value
    unit = payload.unit.strip() if payload.unit else None
    if kind == schemas.InventoryProductKind.ingredient.value and not unit:
        raise HTTPException(status_code=400, detail="La unidad es requerida para Comidas")

    qty = _as_decimal(payload.initial_quantity)
    total_cost = _as_decimal(payload.total_cost)
    unit_cost = (total_cost / qty) if qty > 0 else Decimal("0")

    if existing and existing.is_active:
        raise HTTPException(status_code=409, detail="Ya existe un producto con ese nombre")

    product = existing or models.InventoryProduct(name=name)
    product.name = name
    product.sku = sku
    product.kind = kind
    product.unit = unit
    product.is_active = payload.is_active
    product.on_hand = qty
    product.average_cost = unit_cost
    product.last_cost = unit_cost

    db_session.add(product)
    db_session.flush()

    movement = models.StockMovement(
        product_id=product.id,
        movement_type="in",
        quantity=qty,
        unit_cost=unit_cost,
        reason="initial",
        reference_type="manual",
        reference_id=None,
    )
    db_session.add(movement)
    db_session.commit()
    db_session.refresh(product)
    return product


@router.get("/products/{product_id}", response_model=schemas.InventoryProductOut)
def get_product(product_id: int, db_session: Session = Depends(db.get_db)):
    return _get_product(db_session, product_id)


@router.put("/products/{product_id}", response_model=schemas.InventoryProductOut)
def update_product(
    product_id: int,
    payload: schemas.InventoryProductUpdate,
    db_session: Session = Depends(db.get_db),
):
    product = _get_product(db_session, product_id)
    data = payload.dict(exclude_unset=True)

    if "name" in data and data["name"] is not None:
        candidate = data["name"].strip()
        existing = _find_product_by_name(db_session, name=candidate, exclude_id=product.id)
        if existing:
            raise HTTPException(status_code=409, detail="Ya existe un producto con ese nombre")
        data["name"] = candidate

    if "sku" in data and data["sku"] is not None:
        candidate = data["sku"].strip() or None
        if candidate:
            existing = _find_product_by_sku(db_session, sku=candidate, exclude_id=product.id)
            if existing:
                raise HTTPException(status_code=409, detail="Ya existe un producto con ese SKU")
        data["sku"] = candidate

    if "unit" in data and data["unit"] is not None:
        data["unit"] = data["unit"].strip() or None

    if "kind" in data and data["kind"] is not None:
        data["kind"] = data["kind"].value

    if ("on_hand" in data) != ("total_cost" in data):
        raise HTTPException(
            status_code=400,
            detail="Para ajustar stock/costo debes enviar `on_hand` y `total_cost` juntos",
        )

    pending_stock_adjust = None
    if "on_hand" in data and "total_cost" in data:
        new_on_hand = _as_decimal(data.pop("on_hand"))
        total_cost = _as_decimal(data.pop("total_cost"))
        if new_on_hand < 0:
            raise HTTPException(status_code=400, detail="Stock inválido")
        unit_cost = (total_cost / new_on_hand) if new_on_hand > 0 else Decimal("0")
        pending_stock_adjust = (new_on_hand, unit_cost)

    for key, value in data.items():
        setattr(product, key, value)

    if product.kind == schemas.InventoryProductKind.ingredient.value and not product.unit:
        raise HTTPException(status_code=400, detail="La unidad es requerida para Comidas")

    if pending_stock_adjust is not None:
        new_on_hand, unit_cost = pending_stock_adjust
        old_on_hand = _as_decimal(product.on_hand)
        delta = new_on_hand - old_on_hand
        product.on_hand = new_on_hand
        product.average_cost = unit_cost
        product.last_cost = unit_cost
        movement = models.StockMovement(
            product_id=product.id,
            movement_type="adjust",
            quantity=delta,
            unit_cost=unit_cost,
            reason="manual edit",
            reference_type="manual",
            reference_id=None,
        )
        db_session.add(movement)

    db_session.add(product)
    db_session.commit()
    db_session.refresh(product)
    return product


@router.delete("/products/{product_id}", status_code=204)
def delete_product(product_id: int, db_session: Session = Depends(db.get_db)):
    product = _get_product(db_session, product_id)

    has_relations = (
        db_session.query(models.StockMovement.id)
        .filter(models.StockMovement.product_id == product.id)
        .limit(1)
        .first()
        is not None
        or db_session.query(models.PurchaseItem.id)
        .filter(models.PurchaseItem.product_id == product.id)
        .limit(1)
        .first()
        is not None
        or db_session.query(models.RecipeItem.id)
        .filter(models.RecipeItem.product_id == product.id)
        .limit(1)
        .first()
        is not None
    )

    if has_relations:
        product.is_active = False
        db_session.add(product)
        db_session.commit()
        return None

    db_session.delete(product)
    db_session.commit()
    return None


@router.get("/low-stock", response_model=list[schemas.InventoryProductOut])
def low_stock(db_session: Session = Depends(db.get_db)):
    raise HTTPException(status_code=410, detail="Funcionalidad eliminada (campo mínimo removido)")


@router.post("/movements", response_model=schemas.StockMovementOut, status_code=201)
def create_movement(
    payload: schemas.StockMovementCreate, db_session: Session = Depends(db.get_db)
):
    product = _get_product(db_session, payload.product_id)
    mtype = payload.movement_type.value
    qty = _as_decimal(payload.quantity)

    if mtype == "in":
        delta = qty
        next_on_hand = _as_decimal(product.on_hand) + delta
    elif mtype == "out":
        delta = -qty
        next_on_hand = _as_decimal(product.on_hand) + delta
        if next_on_hand < 0:
            raise HTTPException(status_code=409, detail="Stock insuficiente")
    elif mtype == "adjust":
        next_on_hand = qty
        delta = next_on_hand - _as_decimal(product.on_hand)
    else:
        raise HTTPException(status_code=400, detail="Tipo de movimiento inválido")

    movement = models.StockMovement(
        product_id=product.id,
        movement_type=mtype,
        quantity=delta,
        unit_cost=payload.unit_cost,
        reason=payload.reason,
        reference_type=payload.reference_type,
        reference_id=payload.reference_id,
    )
    product.on_hand = next_on_hand

    db_session.add(movement)
    db_session.add(product)
    db_session.commit()
    db_session.refresh(movement)
    return movement


@router.get("/movements", response_model=list[schemas.StockMovementOut])
def list_movements(
    product_id: int | None = None,
    reference_type: str | None = None,
    db_session: Session = Depends(db.get_db),
):
    query = db_session.query(models.StockMovement)
    if product_id is not None:
        query = query.filter(models.StockMovement.product_id == product_id)
    if reference_type is not None:
        query = query.filter(models.StockMovement.reference_type == reference_type)
    return query.order_by(models.StockMovement.id.desc()).limit(500).all()


@router.post("/suppliers", response_model=schemas.SupplierOut, status_code=201)
def create_supplier(
    payload: schemas.SupplierCreate, db_session: Session = Depends(db.get_db)
):
    existing = (
        db_session.query(models.Supplier)
        .filter(func.lower(models.Supplier.name) == _norm(payload.name))
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Proveedor ya existe")

    supplier = models.Supplier(
        name=payload.name.strip(),
        phone=payload.phone,
        gender=payload.gender.strip() if payload.gender else "male",
        tax_regime=payload.tax_regime,
        income_tax_declarant=payload.income_tax_declarant,
        default_withholding_operation=payload.default_withholding_operation,
        default_withholding_percent=payload.default_withholding_percent,
        is_active=payload.is_active,
    )
    db_session.add(supplier)
    db_session.commit()
    db_session.refresh(supplier)
    return supplier


@router.get("/suppliers", response_model=list[schemas.SupplierOut])
def list_suppliers(active: bool | None = True, db_session: Session = Depends(db.get_db)):
    query = db_session.query(models.Supplier)
    if active is not None:
        query = query.filter(models.Supplier.is_active == active)
    return query.order_by(models.Supplier.name.asc()).all()


@router.put("/suppliers/{supplier_id}", response_model=schemas.SupplierOut)
def update_supplier(
    supplier_id: int,
    payload: schemas.SupplierUpdate,
    db_session: Session = Depends(db.get_db),
):
    supplier = (
        db_session.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")

    data = payload.dict(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        candidate = data["name"].strip()
        existing = (
            db_session.query(models.Supplier)
            .filter(
                func.lower(models.Supplier.name) == _norm(candidate),
                models.Supplier.id != supplier.id,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Proveedor ya existe")
        data["name"] = candidate

    for key, value in data.items():
        setattr(supplier, key, value)

    db_session.add(supplier)
    db_session.commit()
    db_session.refresh(supplier)
    return supplier


def _resolve_purchase_supplier_name(p: models.Purchase) -> str | None:
    if p.supplier:
        return p.supplier.name
    line_names: list[str] = []
    for it in p.items:
        if it.supplier:
            line_names.append(it.supplier.name)
    if not line_names:
        return None
    unique: list[str] = list(dict.fromkeys(line_names))
    if len(unique) == 1:
        return unique[0]
    return "Varios proveedores"


def _purchase_item_to_out(i: models.PurchaseItem) -> schemas.PurchaseItemOut:
    lt = _as_decimal(i.line_total)
    li = _as_decimal(getattr(i, "line_iva", 0) or 0)
    ivr = _as_decimal(getattr(i, "iva_rate", 0) or 0)
    sub = (lt - li).quantize(Decimal("1"))
    return schemas.PurchaseItemOut(
        id=i.id,
        product_id=i.product_id,
        product_name=i.product_name,
        is_other_expense=i.product_id is None and (i.other_label or "").strip() != "",
        supplier_id=i.supplier_id,
        quantity=i.quantity,
        unit_cost=i.unit_cost,
        iva_rate=ivr,
        line_iva=li,
        line_subtotal=sub,
        line_total=lt,
    )


def _purchase_to_out(p: models.Purchase) -> schemas.PurchaseOut:
    outs = [_purchase_item_to_out(i) for i in p.items]
    subtotal_net = sum((x.line_subtotal for x in outs), Decimal("0"))
    total_iva = sum((x.line_iva for x in outs), Decimal("0"))
    gross = sum((x.line_total for x in outs), Decimal("0"))
    return schemas.PurchaseOut(
        id=p.id,
        supplier_id=p.supplier_id,
        supplier_name=_resolve_purchase_supplier_name(p),
        purchased_at=p.purchased_at,
        received_at=p.received_at,
        total_cost=gross if outs else _as_decimal(p.total_cost),
        subtotal_net=subtotal_net,
        total_iva=total_iva,
        withholding_operation_type=p.withholding_operation_type,
        withholding_source_rate=p.withholding_source_rate,
        withholding_source_amount=p.withholding_source_amount,
        created_at=p.created_at,
        items=outs,
    )


def _purchase_out_load_options() -> list:
    return [
        joinedload(models.Purchase.supplier),
        joinedload(models.Purchase.items).joinedload(models.PurchaseItem.product),
        joinedload(models.Purchase.items).joinedload(models.PurchaseItem.supplier),
    ]


@router.post("/purchases", response_model=schemas.PurchaseOut, status_code=201)
def create_purchase(
    payload: schemas.PurchaseCreate, db_session: Session = Depends(db.get_db)
):
    def resolve_supplier_id(supplier_id: int | None) -> int | None:
        if supplier_id is None:
            return None
        supplier = (
            db_session.query(models.Supplier)
            .filter(models.Supplier.id == supplier_id, models.Supplier.is_active == True)  # noqa: E712
            .first()
        )
        if not supplier:
            raise HTTPException(status_code=404, detail="Proveedor no encontrado")
        return supplier.id

    def resolve_product(item: schemas.PurchaseItemCreate) -> models.InventoryProduct:
        if item.product_id:
            return _get_product(db_session, item.product_id)

        name = (item.product_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Producto requerido")

        existing = _find_product_by_name(db_session, name=name)
        if existing:
            if not existing.is_active:
                existing.is_active = True
                db_session.add(existing)
            return existing

        kind = (
            item.product_kind.value
            if item.product_kind is not None
            else schemas.InventoryProductKind.material.value
        )
        unit = item.unit.strip() if item.unit else None
        if kind == schemas.InventoryProductKind.ingredient.value and not unit:
            raise HTTPException(status_code=400, detail="Unidad requerida para ingredientes")

        product = models.InventoryProduct(name=name, kind=kind, unit=unit, is_active=True)
        db_session.add(product)
        db_session.flush()
        return product

    purchase = models.Purchase(
        supplier_id=payload.supplier_id,
        purchased_at=payload.purchased_at,
        received_at=payload.received_at or datetime.utcnow(),
        total_cost=Decimal("0"),
    )

    total = Decimal("0")
    total_net = Decimal("0")
    db_session.add(purchase)
    db_session.flush()  # assign purchase.id

    supplier_ids: set[int] = set()

    for item in payload.items:
        if item.is_other_expense:
            label = (item.product_name or "").strip()
            if not label:
                raise HTTPException(
                    status_code=400, detail="Descripcion requerida para categoria Otros"
                )
            supplier_id = resolve_supplier_id(item.supplier_id)
            if supplier_id is not None:
                supplier_ids.add(supplier_id)
            qty = _as_decimal(item.quantity)
            unit_cost = _as_decimal(item.unit_cost).quantize(Decimal("1"))
            iva_r = _purchase_item_iva_rate(item)
            _, line_iva, line_gross = _purchase_line_amounts(qty, unit_cost, iva_r)
            line_net = (qty * unit_cost).quantize(Decimal("1"))
            total += line_gross
            total_net += line_net
            purchase_item = models.PurchaseItem(
                purchase_id=purchase.id,
                product_id=None,
                other_label=label,
                supplier_id=supplier_id,
                quantity=qty,
                unit_cost=unit_cost,
                iva_rate=iva_r,
                line_iva=line_iva,
                line_total=line_gross,
            )
            db_session.add(purchase_item)
            continue

        product = resolve_product(item)
        supplier_id = resolve_supplier_id(item.supplier_id)
        if supplier_id is not None:
            supplier_ids.add(supplier_id)
        qty = _as_decimal(item.quantity)
        unit_cost = _as_decimal(item.unit_cost).quantize(Decimal("1"))
        iva_r = _purchase_item_iva_rate(item)
        _, line_iva, line_gross = _purchase_line_amounts(qty, unit_cost, iva_r)
        line_net = (qty * unit_cost).quantize(Decimal("1"))
        total += line_gross
        total_net += line_net

        purchase_item = models.PurchaseItem(
            purchase_id=purchase.id,
            product_id=product.id,
            other_label=None,
            supplier_id=supplier_id,
            quantity=qty,
            unit_cost=unit_cost,
            iva_rate=iva_r,
            line_iva=line_iva,
            line_total=line_gross,
        )
        db_session.add(purchase_item)

        on_hand_before = _as_decimal(product.on_hand)
        on_hand_after = on_hand_before + qty
        if on_hand_after > 0:
            avg_before = _as_decimal(product.average_cost)
            value_before = avg_before * on_hand_before
            value_after = value_before + (unit_cost * qty)
            product.average_cost = value_after / on_hand_after
        product.last_cost = unit_cost
        product.on_hand = on_hand_after

        movement = models.StockMovement(
            product_id=product.id,
            movement_type="in",
            quantity=qty,
            unit_cost=unit_cost,
            reason="purchase",
            reference_type="purchase",
            reference_id=purchase.id,
        )
        db_session.add(movement)
        db_session.add(product)

    purchase.total_cost = total.quantize(Decimal("1"))
    n_unique_suppliers = len(supplier_ids)
    sole_supplier_id = next(iter(supplier_ids)) if n_unique_suppliers == 1 else None
    purchase.supplier_id = sole_supplier_id

    withhold_supplier_id: int | None = sole_supplier_id
    if n_unique_suppliers > 1 and payload.supplier_id is not None:
        withhold_supplier_id = resolve_supplier_id(payload.supplier_id)
    elif n_unique_suppliers == 0 and payload.supplier_id is not None:
        withhold_supplier_id = resolve_supplier_id(payload.supplier_id)

    purchase.withholding_operation_type = None
    purchase.withholding_source_rate = None
    purchase.withholding_source_amount = None

    op = payload.withholding_operation_type
    if op is not None and withhold_supplier_id is not None:
        ws = (
            db_session.query(models.Supplier)
            .filter(
                models.Supplier.id == withhold_supplier_id,
                models.Supplier.is_active.is_(True),  # noqa: E712 - SQLAlchemy is_
            )
            .first()
        )
        if ws:
            decl = withholding_co.effective_income_tax_declarant(
                ws.tax_regime,
                ws.income_tax_declarant,
            )
            custom_pct = getattr(ws, "default_withholding_percent", None)
            if custom_pct is not None:
                custom_pct = Decimal(str(custom_pct))
            rate, amount = withholding_co.compute_withholding_source(
                total_net, op, decl, custom_pct
            )
            purchase.withholding_operation_type = op
            if rate is not None and amount is not None:
                purchase.withholding_source_rate = rate
                purchase.withholding_source_amount = amount

    db_session.add(purchase)
    db_session.commit()
    p_full = (
        db_session.query(models.Purchase)
        .options(*_purchase_out_load_options())
        .filter(models.Purchase.id == purchase.id)
        .first()
    )
    if not p_full:
        raise HTTPException(status_code=500, detail="No se pudo cargar la compra creada")
    return _purchase_to_out(p_full)


@router.get("/purchases", response_model=list[schemas.PurchaseOut])
def list_purchases(db_session: Session = Depends(db.get_db)):
    rows = (
        db_session.query(models.Purchase)
        .options(*_purchase_out_load_options())
        .order_by(models.Purchase.id.desc())
        .limit(200)
        .all()
    )
    return [_purchase_to_out(p) for p in rows]


@router.get("/recipes/{menu_item_id}", response_model=schemas.RecipeOut)
def get_recipe(menu_item_id: int, db_session: Session = Depends(db.get_db)):
    recipe = db_session.query(models.Recipe).filter(models.Recipe.menu_item_id == menu_item_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Receta no encontrada")
    return recipe


@router.get("/recipes", response_model=list[schemas.RecipeCatalogOut])
def list_recipes(db_session: Session = Depends(db.get_db)):
    rows = (
        db_session.query(models.Recipe, models.MenuItem)
        .join(models.MenuItem, models.MenuItem.id == models.Recipe.menu_item_id)
        .options(joinedload(models.Recipe.items).joinedload(models.RecipeItem.product))
        .order_by(models.Recipe.id.desc())
        .all()
    )
    response: list[schemas.RecipeCatalogOut] = []
    for recipe, menu_item in rows:
        ingredients: list[schemas.RecipeIngredientOut] = []
        if recipe.items:
            ingredients = _catalog_ingredients_from_line_items(recipe)
        elif isinstance(menu_item.ingredients, list):
            for raw in menu_item.ingredients:
                if isinstance(raw, str):
                    line = raw.strip()
                    if not line:
                        continue
                    ingredients.append(
                        schemas.RecipeIngredientOut(
                            name=line,
                            unit=None,
                            quantity=Decimal("0"),
                            product_id=None,
                        )
                    )
                    continue
                if not isinstance(raw, dict):
                    continue
                name = str(raw.get("name", "")).strip()
                unit = raw.get("unit")
                quantity = raw.get("quantity", 0)
                if not name:
                    continue
                try:
                    q = quantity if isinstance(quantity, Decimal) else Decimal(str(quantity))
                except Exception:
                    q = Decimal("0")
                ingredients.append(
                    schemas.RecipeIngredientOut(
                        name=name,
                        unit=str(unit) if unit is not None else None,
                        quantity=q,
                        product_id=None,
                    )
                )
        response.append(
            schemas.RecipeCatalogOut(
                id=recipe.id,
                menu_item_id=menu_item.id,
                name=menu_item.name,
                yield_quantity=recipe.yield_quantity,
                unit=recipe.unit,
                created_at=recipe.created_at,
                ingredients=ingredients,
                menu_category=menu_item.category or "",
                menu_item_is_active=bool(menu_item.is_active),
            )
        )
    return response


@router.post("/recipes", response_model=schemas.RecipeCatalogOut, status_code=201)
def create_recipe(payload: schemas.RecipeCreate, db_session: Session = Depends(db.get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nombre es requerido")
    if not payload.ingredients:
        raise HTTPException(
            status_code=400,
            detail="Debe agregar al menos un ingrediente con cantidad para la receta.",
        )

    existing_menu_item = (
        db_session.query(models.MenuItem)
        .filter(
            func.lower(models.MenuItem.name) == name.lower(),
            func.lower(models.MenuItem.category) == "recetas",
        )
        .first()
    )
    if existing_menu_item:
        existing_recipe = (
            db_session.query(models.Recipe)
            .filter(models.Recipe.menu_item_id == existing_menu_item.id)
            .first()
        )
        if existing_recipe:
            raise HTTPException(status_code=409, detail="La receta ya existe")

    normalized_ingredients: list[dict[str, object]] = []
    for ingredient in payload.ingredients:
        item_name = ingredient.name.strip()
        if not item_name:
            raise HTTPException(status_code=400, detail="Ingrediente inválido")
        unit = ingredient.unit.strip().upper() if ingredient.unit else None
        if unit and unit not in {"ML", "GR", "UND"}:
            raise HTTPException(status_code=400, detail="Unidad inválida (ML, GR, UND)")
        normalized_ingredients.append(
            {
                "name": item_name,
                "unit": unit,
                "quantity": str(ingredient.quantity),
            }
        )

    if existing_menu_item:
        menu_item = existing_menu_item
        menu_item.name = name
        menu_item.category = "Recetas"
        menu_item.price = 0
        menu_item.description = None
        menu_item.ingredients = normalized_ingredients
        menu_item.is_active = False
        db_session.add(menu_item)
        db_session.flush()
    else:
        menu_item = models.MenuItem(
            name=name,
            category="Recetas",
            price=0,
            description=None,
            ingredients=normalized_ingredients,
            is_active=False,
        )
        db_session.add(menu_item)
        db_session.flush()

    recipe = models.Recipe(
        menu_item_id=menu_item.id,
        yield_quantity=payload.yield_quantity,
        unit=payload.unit.strip().upper() if payload.unit else None,
        notes=payload.notes,
    )
    db_session.add(recipe)
    db_session.flush()
    _sync_recipe_line_items(db_session, recipe, payload.ingredients)
    recipe_id_saved = recipe.id
    menu_item_id_saved = menu_item.id
    db_session.commit()

    recipe = (
        db_session.query(models.Recipe)
        .options(joinedload(models.Recipe.items).joinedload(models.RecipeItem.product))
        .filter(models.Recipe.id == recipe_id_saved)
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=500, detail="No se pudo cargar la receta creada")

    menu_item = (
        db_session.query(models.MenuItem)
        .filter(models.MenuItem.id == menu_item_id_saved)
        .first()
    )
    if not menu_item:
        raise HTTPException(status_code=500, detail="No se pudo cargar el ítem de menú")

    return schemas.RecipeCatalogOut(
        id=recipe.id,
        menu_item_id=menu_item.id,
        name=menu_item.name,
        yield_quantity=recipe.yield_quantity,
        unit=recipe.unit,
        created_at=recipe.created_at,
        ingredients=_catalog_ingredients_from_line_items(recipe),
        menu_category=menu_item.category or "",
        menu_item_is_active=bool(menu_item.is_active),
    )


@router.put("/recipes/{recipe_id}", response_model=schemas.RecipeCatalogOut)
def update_recipe(
    recipe_id: int, payload: schemas.RecipeCreate, db_session: Session = Depends(db.get_db)
):
    recipe = db_session.query(models.Recipe).filter(models.Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Receta no encontrada")

    menu_item = (
        db_session.query(models.MenuItem)
        .filter(models.MenuItem.id == recipe.menu_item_id)
        .first()
    )
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item no encontrado")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nombre es requerido")
    if not payload.ingredients:
        raise HTTPException(
            status_code=400,
            detail="Debe agregar al menos un ingrediente con cantidad para la receta.",
        )

    existing = (
        db_session.query(models.MenuItem)
        .filter(
            func.lower(models.MenuItem.name) == name.lower(),
            func.lower(models.MenuItem.category) == "recetas",
            models.MenuItem.id != menu_item.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="La receta ya existe")

    normalized_ingredients: list[dict[str, object]] = []
    for ingredient in payload.ingredients:
        item_name = ingredient.name.strip()
        if not item_name:
            raise HTTPException(status_code=400, detail="Ingrediente inválido")
        unit = ingredient.unit.strip().upper() if ingredient.unit else None
        if unit and unit not in {"ML", "GR", "UND"}:
            raise HTTPException(status_code=400, detail="Unidad inválida (ML, GR, UND)")
        normalized_ingredients.append(
            {
                "name": item_name,
                "unit": unit,
                "quantity": str(ingredient.quantity),
            }
        )

    menu_item.name = name
    menu_item.ingredients = normalized_ingredients
    recipe.yield_quantity = payload.yield_quantity
    recipe.unit = payload.unit.strip().upper() if payload.unit else None
    recipe.notes = payload.notes

    _sync_recipe_line_items(db_session, recipe, payload.ingredients)

    db_session.add(menu_item)
    db_session.add(recipe)
    recipe_id_saved = recipe.id
    menu_item_id_saved = menu_item.id
    db_session.commit()

    recipe = (
        db_session.query(models.Recipe)
        .options(joinedload(models.Recipe.items).joinedload(models.RecipeItem.product))
        .filter(models.Recipe.id == recipe_id_saved)
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=500, detail="No se pudo cargar la receta actualizada")

    menu_item = (
        db_session.query(models.MenuItem)
        .filter(models.MenuItem.id == menu_item_id_saved)
        .first()
    )
    if not menu_item:
        raise HTTPException(status_code=500, detail="No se pudo cargar el ítem de menú")

    return schemas.RecipeCatalogOut(
        id=recipe.id,
        menu_item_id=menu_item.id,
        name=menu_item.name,
        yield_quantity=recipe.yield_quantity,
        unit=recipe.unit,
        created_at=recipe.created_at,
        ingredients=_catalog_ingredients_from_line_items(recipe),
        menu_category=menu_item.category or "",
        menu_item_is_active=bool(menu_item.is_active),
    )


@router.delete("/recipes/{recipe_id}", status_code=204)
def delete_recipe(recipe_id: str, db_session: Session = Depends(db.get_db)):
    try:
        recipe_id_int = int(recipe_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Id inválido")

    recipe = (
        db_session.query(models.Recipe).filter(models.Recipe.id == recipe_id_int).first()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Receta no encontrada")

    db_session.delete(recipe)
    db_session.commit()
    return None


def _consume_recipe_stock(
    db_session: Session,
    *,
    recipe: models.Recipe,
    sold_qty: Decimal,
    sale_id: int | None = None,
) -> tuple[int, Decimal]:
    """Descuenta inventario según la receta. No hace commit. Sin ítems = no-op."""
    if not recipe.items:
        return 0, Decimal("0")

    yield_qty = _as_decimal(recipe.yield_quantity)
    if yield_qty <= 0:
        return 0, Decimal("0")
    multiplier = _as_decimal(sold_qty) / yield_qty

    movements_created = 0
    total_cost = Decimal("0")

    for recipe_item in recipe.items:
        product = _get_product(db_session, recipe_item.product_id)
        base_qty = _as_decimal(recipe_item.quantity) * multiplier
        waste = _as_decimal(recipe_item.waste_pct)
        required = base_qty * (Decimal("1") + waste)

        next_on_hand = _as_decimal(product.on_hand) - required
        if next_on_hand < 0:
            raise HTTPException(
                status_code=409,
                detail=f"Stock insuficiente para {product.name}",
            )

        movement = models.StockMovement(
            product_id=product.id,
            movement_type="out",
            quantity=-required,
            unit_cost=product.average_cost,
            reason="sale",
            reference_type="sale",
            reference_id=sale_id,
        )
        product.on_hand = next_on_hand
        db_session.add(movement)
        db_session.add(product)
        movements_created += 1
        total_cost += required * _as_decimal(product.average_cost)

    return movements_created, total_cost


def apply_pos_order_inventory_consumption(
    db_session: Session,
    order: models.PosOrder,
    sale_id: int,
) -> None:
    """Descuenta stock por cada línea del pedido según receta (si existe). Sin commit."""
    for item in order.items:
        if item.courtesy:
            continue
        qty = _as_decimal(item.quantity)
        if qty <= 0:
            continue
        recipe = (
            db_session.query(models.Recipe)
            .options(joinedload(models.Recipe.items))
            .filter(models.Recipe.menu_item_id == item.menu_item_id)
            .first()
        )
        if not recipe:
            continue
        _consume_recipe_stock(db_session, recipe=recipe, sold_qty=qty, sale_id=sale_id)


@router.put("/recipes/by-menu-item/{menu_item_id}", response_model=schemas.RecipeOut)
def upsert_recipe(
    menu_item_id: int, payload: schemas.RecipeUpsert, db_session: Session = Depends(db.get_db)
):
    menu_item = db_session.query(models.MenuItem).filter(models.MenuItem.id == menu_item_id).first()
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item no encontrado")

    recipe = db_session.query(models.Recipe).filter(models.Recipe.menu_item_id == menu_item_id).first()
    if not recipe:
        recipe = models.Recipe(menu_item_id=menu_item_id)
        db_session.add(recipe)
        db_session.flush()

    recipe.yield_quantity = payload.yield_quantity
    recipe.notes = payload.notes
    recipe.items = []

    for item in payload.items:
        _get_product(db_session, item.product_id)
        recipe.items.append(
            models.RecipeItem(
                product_id=item.product_id,
                quantity=item.quantity,
                waste_pct=item.waste_pct,
            )
        )

    db_session.add(recipe)
    db_session.commit()
    db_session.refresh(recipe)
    return recipe


@router.post("/consume", response_model=schemas.ConsumeSaleResult)
def consume_sale(payload: schemas.ConsumeSaleRequest, db_session: Session = Depends(db.get_db)):
    recipe = (
        db_session.query(models.Recipe)
        .options(joinedload(models.Recipe.items))
        .filter(models.Recipe.menu_item_id == payload.menu_item_id)
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=409, detail="No hay receta configurada para este producto")

    movements_created, total_cost = _consume_recipe_stock(
        db_session,
        recipe=recipe,
        sold_qty=_as_decimal(payload.quantity),
        sale_id=None,
    )
    db_session.commit()
    return schemas.ConsumeSaleResult(
        menu_item_id=payload.menu_item_id,
        quantity=payload.quantity,
        total_cost=total_cost,
        movements_created=movements_created,
    )


@router.post("/bootstrap/from-menu-ingredients")
def bootstrap_products_from_menu_ingredients(db_session: Session = Depends(db.get_db)):
    items = db_session.query(models.MenuItem).all()
    created = 0
    for item in items:
        ingredients = item.ingredients or []
        if not isinstance(ingredients, list):
            continue
        for raw in ingredients:
            if not isinstance(raw, str):
                continue
            name = raw.strip()
            if not name:
                continue
            if _find_product_by_name(db_session, name=name):
                continue
            product = models.InventoryProduct(
                name=name,
                kind="ingredient",
                unit="unit",
                is_active=True,
            )
            db_session.add(product)
            created += 1

    db_session.commit()
    return {"created": created}


def _xlsx_response(filename: str, build_workbook) -> Response:
    try:
        import openpyxl  # type: ignore
    except Exception:
        raise HTTPException(
            status_code=501,
            detail="Exportar a Excel requiere `openpyxl` instalado en el backend",
        )

    wb = openpyxl.Workbook()
    build_workbook(wb)
    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return Response(
        content=out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/exports/inventory.xlsx")
def export_inventory_xlsx(db_session: Session = Depends(db.get_db)):
    products = (
        db_session.query(models.InventoryProduct)
        .order_by(models.InventoryProduct.name.asc())
        .all()
    )

    def build(wb):
        ws = wb.active
        ws.title = "Inventario"
        ws.append(
            [
                "ID",
                "Nombre",
                "Tipo",
                "Unidad",
                "Stock",
                "Costo promedio",
                "Último costo",
                "Activo",
                "Creado",
            ]
        )
        for p in products:
            ws.append(
                [
                    p.id,
                    p.name,
                    p.kind,
                    p.unit,
                    float(p.on_hand),
                    float(p.average_cost),
                    float(p.last_cost),
                    bool(p.is_active),
                    p.created_at.isoformat() if p.created_at else None,
                ]
            )

    return _xlsx_response("inventory.xlsx", build)


@router.get("/exports/purchases.xlsx")
def export_purchases_xlsx(
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    db_session: Session = Depends(db.get_db),
):
    raise HTTPException(
        status_code=410,
        detail="Export a Excel de compras eliminado; usa el informe dentro del sistema (/inventory/purchases).",
    )
