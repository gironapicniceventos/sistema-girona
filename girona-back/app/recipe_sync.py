from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models


class RecipeSyncError(ValueError):
    pass


def _field(row: Any, key: str, default: Any = None) -> Any:
    if isinstance(row, dict):
        return row.get(key, default)
    return getattr(row, key, default)


def _as_decimal(value: Any, *, default: Decimal | None = None) -> Decimal:
    if value is None or value == "":
        if default is not None:
            return default
        raise RecipeSyncError("Cantidad invalida")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise RecipeSyncError("Cantidad invalida") from exc


def _json_decimal(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def recipe_unit_to_inventory_unit(unit: str | None) -> str | None:
    raw = (unit or "").strip()
    if not raw:
        return None
    upper = raw.upper()
    lower = raw.lower()
    if upper in {"GR", "G"} or lower == "gramos":
        return "gramos"
    if upper == "ML" or lower == "mililitros":
        return "mililitros"
    if upper in {"UND", "UN", "UD"} or lower in {"unidad", "unidades"}:
        return "unidades"
    return raw


def inventory_unit_to_recipe_unit(unit: str | None) -> str | None:
    raw = (unit or "").strip()
    if not raw:
        return None
    upper = raw.upper()
    lower = raw.lower()
    if upper in {"GR", "G"} or lower == "gramos":
        return "GR"
    if upper == "ML" or lower == "mililitros":
        return "ML"
    if upper in {"UND", "UN", "UD"} or lower in {"unidad", "unidades"}:
        return "UND"
    return upper


def _normalize_product_name(name: str) -> str:
    return " ".join(name.strip().split())


def find_inventory_product_by_name(
    db_session: Session, name: str
) -> models.InventoryProduct | None:
    normalized = _normalize_product_name(name)
    if not normalized:
        return None
    return (
        db_session.query(models.InventoryProduct)
        .filter(func.lower(models.InventoryProduct.name) == normalized.lower())
        .first()
    )


def ensure_inventory_product_for_recipe_ingredient(
    db_session: Session,
    *,
    name: str,
    unit: str | None = None,
    product_id: int | None = None,
    kind: str = "ingredient",
) -> models.InventoryProduct:
    normalized_name = _normalize_product_name(name)
    if not normalized_name:
        raise RecipeSyncError("Ingrediente invalido")

    inventory_unit = recipe_unit_to_inventory_unit(unit)

    if product_id is not None:
        product = (
            db_session.query(models.InventoryProduct)
            .filter(models.InventoryProduct.id == product_id)
            .first()
        )
        if not product:
            raise RecipeSyncError(f"Producto de inventario no encontrado para {normalized_name}")
        if not product.is_active:
            product.is_active = True
        if inventory_unit and not product.unit:
            product.unit = inventory_unit
        db_session.add(product)
        return product

    product = find_inventory_product_by_name(db_session, normalized_name)
    if product:
        if not product.is_active:
            product.is_active = True
        if inventory_unit and not product.unit:
            product.unit = inventory_unit
        db_session.add(product)
        return product

    product = models.InventoryProduct(
        name=normalized_name,
        kind=kind,
        unit=inventory_unit,
        on_hand=Decimal("0"),
        average_cost=Decimal("0"),
        last_cost=Decimal("0"),
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()
    return product


def _normalize_recipe_rows(rows: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for row in rows:
        name = str(_field(row, "name", "") or "").strip()
        quantity_value = _field(row, "quantity", None)
        if quantity_value is None:
            quantity_value = _field(row, "weight", None)
        if not name and (quantity_value is None or quantity_value == ""):
            continue
        if not name:
            raise RecipeSyncError("Cada ingrediente debe tener nombre")

        quantity = _as_decimal(quantity_value)
        if quantity <= 0:
            raise RecipeSyncError(f"Cantidad invalida para {name}")

        waste_pct = _as_decimal(_field(row, "waste_pct", None), default=Decimal("0"))
        if waste_pct < 0:
            raise RecipeSyncError(f"Merma invalida para {name}")

        raw_product_id = _field(row, "product_id", None)
        product_id: int | None = None
        if raw_product_id is not None and raw_product_id != "":
            try:
                product_id = int(raw_product_id)
            except (TypeError, ValueError) as exc:
                raise RecipeSyncError(f"Producto de inventario invalido para {name}") from exc

        price_raw = _field(row, "price", None)
        price = _as_decimal(price_raw, default=Decimal("0")) if price_raw not in (None, "") else None
        total_raw = _field(row, "total", None)
        total = _as_decimal(total_raw, default=Decimal("0")) if total_raw not in (None, "") else None

        normalized.append(
            {
                "name": name,
                "unit": str(_field(row, "unit", "") or "").strip() or None,
                "quantity": quantity,
                "waste_pct": waste_pct,
                "product_id": product_id,
                "price": price,
                "total": total,
            }
        )
    if not normalized:
        raise RecipeSyncError("Debe agregar al menos un ingrediente con cantidad")
    return normalized


def sync_recipe_items_from_rows(
    db_session: Session,
    *,
    recipe: models.Recipe,
    rows: list[Any],
) -> list[dict[str, Any]]:
    normalized_rows = _normalize_recipe_rows(rows)
    recipe_items: list[models.RecipeItem] = []
    menu_ingredients: list[dict[str, Any]] = []

    for row in normalized_rows:
        product = ensure_inventory_product_for_recipe_ingredient(
            db_session,
            name=row["name"],
            unit=row["unit"],
            product_id=row["product_id"],
        )
        recipe_items.append(
            models.RecipeItem(
                product_id=product.id,
                quantity=row["quantity"],
                waste_pct=row["waste_pct"],
            )
        )

        recipe_unit = row["unit"] or inventory_unit_to_recipe_unit(product.unit)
        price = row["price"]
        if price is None:
            price = Decimal(product.average_cost or 0)
        total = row["total"]
        if total is None and price is not None:
            total = row["quantity"] * price

        menu_ingredients.append(
            {
                "name": product.name,
                "unit": recipe_unit,
                "weight": _json_decimal(row["quantity"]),
                "price": _json_decimal(price),
                "total": _json_decimal(total),
                "product_id": product.id,
            }
        )

    recipe.items = recipe_items
    db_session.add(recipe)
    return menu_ingredients


def sync_menu_item_recipe_from_ingredients(
    db_session: Session,
    *,
    menu_item: models.MenuItem,
    ingredients: list[Any],
) -> list[dict[str, Any]]:
    recipe = (
        db_session.query(models.Recipe)
        .filter(models.Recipe.menu_item_id == menu_item.id)
        .first()
    )
    if not recipe:
        recipe = models.Recipe(
            menu_item_id=menu_item.id,
            yield_quantity=Decimal("1"),
            unit="porcion",
        )
        db_session.add(recipe)
        db_session.flush()

    return sync_recipe_items_from_rows(db_session, recipe=recipe, rows=ingredients)
