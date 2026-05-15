from __future__ import annotations

import unicodedata

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import db, models, schemas

router = APIRouter(prefix="/personnel", tags=["personnel"])

WAITER_ROLES = frozenset({"mesero", "caja_mesero"})


def _norm(value: str) -> str:
    return value.strip().lower()


def _norm_name_for_match(value: str) -> str:
    """Compara nombres ignorando mayúsculas, espacios extremos y tildes."""
    s = (value or "").strip().lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def resolve_waiter_for_staff_user(
    db_session: Session, user: models.User
) -> tuple[int | None, str | None]:
    """
    Devuelve (waiter_id, nombre en ficha mesero) para POS: vínculo user_id o un único mesero
    activo con el mismo nombre que el perfil.
    """
    linked = (
        db_session.query(models.Waiter)
        .filter(
            models.Waiter.user_id == user.id,
            models.Waiter.is_active == True,  # noqa: E712
        )
        .first()
    )
    if linked:
        return linked.id, linked.name

    if (user.role or "").strip().lower() not in WAITER_ROLES:
        return None, None

    key = _norm_name_for_match(user.full_name or "")
    if not key:
        return None, None

    candidates = [
        w
        for w in db_session.query(models.Waiter)
        .filter(models.Waiter.is_active == True)  # noqa: E712
        .all()
        if _norm_name_for_match(w.name) == key
    ]
    if len(candidates) == 1:
        w = candidates[0]
        return w.id, w.name
    return None, None


def _ensure_user_available_for_waiter(
    db_session: Session, user_id: int, *, exclude_waiter_id: int | None
) -> None:
    user = db_session.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    q = db_session.query(models.Waiter).filter(models.Waiter.user_id == user_id)
    if exclude_waiter_id is not None:
        q = q.filter(models.Waiter.id != exclude_waiter_id)
    if q.first():
        raise HTTPException(
            status_code=409,
            detail="Ese usuario ya esta vinculado a otra ficha de mesero",
        )


def _supplier_or_404(db_session: Session, supplier_id: int) -> models.Supplier:
    supplier = (
        db_session.query(models.Supplier)
        .filter(models.Supplier.id == supplier_id)
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return supplier


def _waiter_or_404(db_session: Session, waiter_id: int) -> models.Waiter:
    waiter = (
        db_session.query(models.Waiter)
        .filter(models.Waiter.id == waiter_id)
        .first()
    )
    if not waiter:
        raise HTTPException(status_code=404, detail="Mesero no encontrado")
    return waiter


def _customer_or_404(db_session: Session, customer_id: int) -> models.Customer:
    customer = (
        db_session.query(models.Customer)
        .filter(models.Customer.id == customer_id)
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return customer


def _supplier_ingredient_ids(db_session: Session, supplier_id: int) -> list[int]:
    rows = (
        db_session.query(models.SupplierIngredient.product_id)
        .filter(models.SupplierIngredient.supplier_id == supplier_id)
        .order_by(models.SupplierIngredient.product_id.asc())
        .all()
    )
    return [int(r[0]) for r in rows]


def _supplier_out(db_session: Session, supplier: models.Supplier) -> schemas.SupplierOut:
    dwo = getattr(supplier, "default_withholding_operation", None)
    if dwo not in ("purchase", "service"):
        dwo = "purchase"
    wh_pct = getattr(supplier, "default_withholding_percent", None)
    return schemas.SupplierOut(
        id=supplier.id,
        name=supplier.name,
        phone=supplier.phone,
        gender=supplier.gender,
        tax_regime=supplier.tax_regime
        if supplier.tax_regime in ("common", "natural")
        else "common",
        income_tax_declarant=supplier.income_tax_declarant,
        default_withholding_operation=dwo,
        default_withholding_percent=wh_pct,
        is_active=supplier.is_active,
        created_at=supplier.created_at,
        ingredient_product_ids=_supplier_ingredient_ids(db_session, supplier.id),
    )


def _sync_supplier_ingredients(
    db_session: Session, supplier_id: int, product_ids: list[int]
) -> None:
    seen: set[int] = set()
    unique: list[int] = []
    for pid in product_ids:
        if pid in seen:
            continue
        seen.add(pid)
        unique.append(pid)

    for pid in unique:
        product = (
            db_session.query(models.InventoryProduct)
            .filter(models.InventoryProduct.id == pid)
            .first()
        )
        if not product:
            raise HTTPException(status_code=404, detail=f"Producto de inventario no encontrado (id {pid})")
        if product.kind != schemas.InventoryProductKind.ingredient.value:
            raise HTTPException(
                status_code=400,
                detail="Solo se pueden vincular productos de tipo ingrediente",
            )

    db_session.query(models.SupplierIngredient).filter(
        models.SupplierIngredient.supplier_id == supplier_id
    ).delete(synchronize_session=False)
    for pid in unique:
        db_session.add(
            models.SupplierIngredient(supplier_id=supplier_id, product_id=pid)
        )


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
    db_session.flush()
    _sync_supplier_ingredients(db_session, supplier.id, list(payload.ingredient_product_ids or []))
    db_session.commit()
    db_session.refresh(supplier)
    return _supplier_out(db_session, supplier)


@router.get("/suppliers", response_model=list[schemas.SupplierOut])
def list_suppliers(active: bool | None = True, db_session: Session = Depends(db.get_db)):
    query = db_session.query(models.Supplier)
    if active is not None:
        query = query.filter(models.Supplier.is_active == active)
    rows = query.order_by(models.Supplier.name.asc()).all()
    return [_supplier_out(db_session, s) for s in rows]


@router.get("/suppliers/{supplier_id}", response_model=schemas.SupplierOut)
def get_supplier(supplier_id: int, db_session: Session = Depends(db.get_db)):
    supplier = _supplier_or_404(db_session, supplier_id)
    return _supplier_out(db_session, supplier)


@router.put("/suppliers/{supplier_id}", response_model=schemas.SupplierOut)
def update_supplier(
    supplier_id: int,
    payload: schemas.SupplierUpdate,
    db_session: Session = Depends(db.get_db),
):
    supplier = _supplier_or_404(db_session, supplier_id)

    data = payload.dict(exclude_unset=True)
    ingredient_ids = data.pop("ingredient_product_ids", None)
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

    if "phone" in data and data["phone"] is not None:
        data["phone"] = data["phone"].strip() or None
    if "gender" in data and data["gender"] is not None:
        data["gender"] = data["gender"].strip() or "male"

    for key, value in data.items():
        setattr(supplier, key, value)

    if ingredient_ids is not None:
        _sync_supplier_ingredients(db_session, supplier.id, list(ingredient_ids))

    db_session.add(supplier)
    db_session.commit()
    db_session.refresh(supplier)
    return _supplier_out(db_session, supplier)


@router.post("/waiters", response_model=schemas.WaiterOut, status_code=201)
def create_waiter(payload: schemas.WaiterCreate, db_session: Session = Depends(db.get_db)):
    name = payload.name.strip()
    existing = (
        db_session.query(models.Waiter)
        .filter(func.lower(models.Waiter.name) == _norm(name))
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Mesero ya existe")

    user_id: int | None = payload.user_id
    if user_id is not None:
        _ensure_user_available_for_waiter(db_session, user_id, exclude_waiter_id=None)

    waiter = models.Waiter(
        name=name,
        gender=payload.gender.strip() if payload.gender else "male",
        is_active=payload.is_active,
        user_id=user_id,
    )
    db_session.add(waiter)
    db_session.commit()
    db_session.refresh(waiter)
    return waiter


@router.get("/waiters", response_model=list[schemas.WaiterOut])
def list_waiters(active: bool | None = True, db_session: Session = Depends(db.get_db)):
    query = db_session.query(models.Waiter)
    if active is not None:
        query = query.filter(models.Waiter.is_active == active)
    return query.order_by(models.Waiter.name.asc()).all()


@router.get("/waiters/{waiter_id}", response_model=schemas.WaiterOut)
def get_waiter(waiter_id: int, db_session: Session = Depends(db.get_db)):
    return _waiter_or_404(db_session, waiter_id)


@router.put("/waiters/{waiter_id}", response_model=schemas.WaiterOut)
def update_waiter(
    waiter_id: int,
    payload: schemas.WaiterUpdate,
    db_session: Session = Depends(db.get_db),
):
    waiter = _waiter_or_404(db_session, waiter_id)

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        candidate = data["name"].strip()
        existing = (
            db_session.query(models.Waiter)
            .filter(
                func.lower(models.Waiter.name) == _norm(candidate),
                models.Waiter.id != waiter.id,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Mesero ya existe")
        data["name"] = candidate
    if "gender" in data and data["gender"] is not None:
        data["gender"] = data["gender"].strip() or "male"
    if "user_id" in data:
        uid = data["user_id"]
        if uid is not None:
            _ensure_user_available_for_waiter(
                db_session, int(uid), exclude_waiter_id=waiter.id
            )

    for key, value in data.items():
        setattr(waiter, key, value)

    db_session.add(waiter)
    db_session.commit()
    db_session.refresh(waiter)
    return waiter


@router.post("/customers", response_model=schemas.CustomerOut, status_code=201)
def create_customer(
    payload: schemas.CustomerCreate, db_session: Session = Depends(db.get_db)
):
    name = payload.name.strip()
    identity_document = payload.identity_document.strip()
    phone = payload.phone.strip() if payload.phone else None

    existing = (
        db_session.query(models.Customer)
        .filter(func.lower(models.Customer.identity_document) == _norm(identity_document))
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Cliente ya existe")

    customer = models.Customer(
        name=name,
        identity_document=identity_document,
        phone=phone,
        gender=payload.gender.strip() if payload.gender else "male",
        is_active=payload.is_active,
    )
    db_session.add(customer)
    db_session.commit()
    db_session.refresh(customer)
    return customer


@router.get("/customers", response_model=list[schemas.CustomerOut])
def list_customers(active: bool | None = True, db_session: Session = Depends(db.get_db)):
    query = db_session.query(models.Customer)
    if active is not None:
        query = query.filter(models.Customer.is_active == active)
    return query.order_by(models.Customer.name.asc()).all()


@router.get("/customers/{customer_id}", response_model=schemas.CustomerOut)
def get_customer(customer_id: int, db_session: Session = Depends(db.get_db)):
    return _customer_or_404(db_session, customer_id)


@router.put("/customers/{customer_id}", response_model=schemas.CustomerOut)
def update_customer(
    customer_id: int,
    payload: schemas.CustomerUpdate,
    db_session: Session = Depends(db.get_db),
):
    customer = _customer_or_404(db_session, customer_id)

    data = payload.dict(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()

    if "identity_document" in data and data["identity_document"] is not None:
        candidate = data["identity_document"].strip()
        existing = (
            db_session.query(models.Customer)
            .filter(
                func.lower(models.Customer.identity_document) == _norm(candidate),
                models.Customer.id != customer.id,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Cliente ya existe")
        data["identity_document"] = candidate

    if "phone" in data and data["phone"] is not None:
        data["phone"] = data["phone"].strip() or None
    if "gender" in data and data["gender"] is not None:
        data["gender"] = data["gender"].strip() or "male"

    for key, value in data.items():
        setattr(customer, key, value)

    db_session.add(customer)
    db_session.commit()
    db_session.refresh(customer)
    return customer
