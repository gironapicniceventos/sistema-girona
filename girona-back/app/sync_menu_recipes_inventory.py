from __future__ import annotations

import argparse

from sqlalchemy.orm import Session

from . import db, models
from .recipe_sync import (
    RecipeSyncError,
    ensure_inventory_product_for_recipe_ingredient,
    sync_menu_item_recipe_from_ingredients,
)


def _has_structured_ingredients(value) -> bool:
    if not isinstance(value, list) or not value:
        return False
    return all(isinstance(item, dict) for item in value)


def _norm(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def is_direct_sale_inventory_item(menu_item: models.MenuItem) -> bool:
    category = _norm(menu_item.category)
    name = _norm(menu_item.name)

    if category in {"gaseosas", "cervezas nacionales", "cervezas internacionales"}:
        return True
    if category == "vinos":
        return not (
            name.startswith("copa ")
            or name.startswith("jarra ")
            or "sangria" in name
            or "sangría" in name
        )
    if category == "licores y shots":
        return name.startswith("botella ")
    if name in {"agua sin gas", "jugo de caja"}:
        return True
    return False


def sync_direct_sale_inventory_item(
    session: Session,
    menu_item: models.MenuItem,
) -> None:
    product = ensure_inventory_product_for_recipe_ingredient(
        session,
        name=menu_item.name,
        unit="UND",
    )
    recipe = (
        session.query(models.Recipe)
        .filter(models.Recipe.menu_item_id == menu_item.id)
        .first()
    )
    if not recipe:
        recipe = models.Recipe(
            menu_item_id=menu_item.id,
            yield_quantity=1,
            unit="unidad",
            notes="Venta directa de inventario",
        )
        session.add(recipe)
        session.flush()
    recipe.yield_quantity = 1
    recipe.unit = "unidad"
    recipe.notes = recipe.notes or "Venta directa de inventario"
    recipe.items = [
        models.RecipeItem(
            product_id=product.id,
            quantity=1,
            waste_pct=0,
        )
    ]
    menu_item.ingredients = [
        {
            "name": product.name,
            "unit": "UND",
            "weight": 1,
            "price": float(product.average_cost or 0),
            "total": float(product.average_cost or 0),
            "product_id": product.id,
        }
    ]
    session.add(recipe)
    session.add(menu_item)


def run_sync(
    session: Session,
    *,
    include_inactive: bool = False,
    overwrite: bool = False,
    verbose: bool = False,
    direct_sales: bool = False,
) -> dict[str, int]:
    query = session.query(models.MenuItem).order_by(models.MenuItem.id.asc())
    if not include_inactive:
        query = query.filter(models.MenuItem.is_active == True)  # noqa: E712

    stats = {
        "scanned": 0,
        "synced": 0,
        "created_recipes": 0,
        "skipped_without_json": 0,
        "skipped_strings": 0,
        "skipped_existing_recipe_items": 0,
        "direct_sales_synced": 0,
        "failed": 0,
        "products_before": session.query(models.InventoryProduct).count(),
        "products_after": 0,
    }

    for menu_item in query.all():
        stats["scanned"] += 1
        ingredients = menu_item.ingredients
        if not isinstance(ingredients, list) or not ingredients:
            if direct_sales and is_direct_sale_inventory_item(menu_item):
                try:
                    sync_direct_sale_inventory_item(session, menu_item)
                    stats["direct_sales_synced"] += 1
                except RecipeSyncError as exc:
                    stats["failed"] += 1
                    print(f"skip direct menu_item={menu_item.id} {menu_item.name}: {exc}")
                continue
            stats["skipped_without_json"] += 1
            if verbose:
                print(f"skip empty menu_item={menu_item.id} {menu_item.name}")
            continue
        if not _has_structured_ingredients(ingredients):
            if direct_sales and is_direct_sale_inventory_item(menu_item):
                try:
                    sync_direct_sale_inventory_item(session, menu_item)
                    stats["direct_sales_synced"] += 1
                except RecipeSyncError as exc:
                    stats["failed"] += 1
                    print(f"skip direct menu_item={menu_item.id} {menu_item.name}: {exc}")
                continue
            stats["skipped_strings"] += 1
            if verbose:
                print(f"skip text menu_item={menu_item.id} {menu_item.name}: {ingredients}")
            continue

        recipe = (
            session.query(models.Recipe)
            .filter(models.Recipe.menu_item_id == menu_item.id)
            .first()
        )
        if recipe and recipe.items and not overwrite:
            stats["skipped_existing_recipe_items"] += 1
            if verbose:
                print(f"skip existing recipe_items menu_item={menu_item.id} {menu_item.name}")
            continue
        if not recipe:
            stats["created_recipes"] += 1

        try:
            menu_item.ingredients = sync_menu_item_recipe_from_ingredients(
                session,
                menu_item=menu_item,
                ingredients=ingredients,
            )
            session.add(menu_item)
            stats["synced"] += 1
        except RecipeSyncError as exc:
            stats["failed"] += 1
            print(f"skip menu_item={menu_item.id} {menu_item.name}: {exc}")

    session.flush()
    stats["products_after"] = session.query(models.InventoryProduct).count()
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync menu JSON recipes into recipes/recipe_items and inventory products."
    )
    parser.add_argument("--include-inactive", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--direct-sales", action="store_true")
    args = parser.parse_args()

    session = db.SessionLocal()
    try:
        stats = run_sync(
            session,
            include_inactive=args.include_inactive,
            overwrite=args.overwrite,
            verbose=args.verbose,
            direct_sales=args.direct_sales,
        )
        if args.dry_run:
            session.rollback()
        else:
            session.commit()
        for key, value in stats.items():
            print(f"{key}: {value}")
        if args.dry_run:
            print("dry_run: rolled back")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
