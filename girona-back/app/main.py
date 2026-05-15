import os
import logging

from fastapi import FastAPI
from sqlalchemy.exc import OperationalError
from sqlalchemy import text
from sqlalchemy.orm import Session
from . import auth, db, factus, inventory, menu, models, personnel, pos, reservations, sales, seed_staff

app = FastAPI()

logger = logging.getLogger("uvicorn.error")

def _auto_migrate_schema() -> None:
    if os.getenv("AUTO_MIGRATE_SCHEMA", "1") != "1":
        return
    try:
        with db.engine.begin() as conn:
            if conn.dialect.name == "sqlite":
                table_exists = conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name='pos_tables'")
                ).first()
                if table_exists:
                    columns = {
                        str(row[1])
                        for row in conn.execute(text("PRAGMA table_info(pos_tables)")).fetchall()
                    }
                    if "section" not in columns:
                        conn.execute(
                            text(
                                "ALTER TABLE pos_tables "
                                "ADD COLUMN section VARCHAR NOT NULL DEFAULT 'ENTRADA'"
                            )
                        )
                pos_orders_exists = conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name='pos_orders'")
                ).first()
                if pos_orders_exists:
                    pos_order_columns = {
                        str(row[1])
                        for row in conn.execute(text("PRAGMA table_info(pos_orders)")).fetchall()
                    }
                    if "utility_total" not in pos_order_columns:
                        conn.execute(
                            text(
                                "ALTER TABLE pos_orders "
                                "ADD COLUMN utility_total NUMERIC(14, 2) NOT NULL DEFAULT 0"
                            )
                        )
                sales_exists = conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name='sales'")
                ).first()
                if sales_exists:
                    sales_columns = {
                        str(row[1])
                        for row in conn.execute(text("PRAGMA table_info(sales)")).fetchall()
                    }
                    if "utility_total" not in sales_columns:
                        conn.execute(
                            text(
                                "ALTER TABLE sales "
                                "ADD COLUMN utility_total NUMERIC(14, 2) NOT NULL DEFAULT 0"
                            )
                        )
                    if "payment_method" not in sales_columns:
                        conn.execute(
                            text("ALTER TABLE sales ADD COLUMN payment_method VARCHAR(32)")
                        )
                reservations_exists = conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name='reservations'")
                ).first()
                if reservations_exists:
                    reservations_columns = {
                        str(row[1])
                        for row in conn.execute(text("PRAGMA table_info(reservations)")).fetchall()
                    }
                    if "google_event_id" not in reservations_columns:
                        conn.execute(
                            text(
                                "ALTER TABLE reservations "
                                "ADD COLUMN google_event_id VARCHAR"
                            )
                        )
                si_exists = conn.execute(
                    text(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_ingredients'"
                    )
                ).first()
                if not si_exists:
                    conn.execute(
                        text(
                            """
                            CREATE TABLE supplier_ingredients (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
                                product_id INTEGER NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
                                UNIQUE (supplier_id, product_id)
                            )
                            """
                        )
                    )
                pi_sqlite = conn.execute(
                    text(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_items'"
                    )
                ).first()
                if pi_sqlite:
                    pi_cols = {
                        str(row[1])
                        for row in conn.execute(text("PRAGMA table_info(purchase_items)")).fetchall()
                    }
                    if "other_label" not in pi_cols:
                        conn.execute(
                            text("ALTER TABLE purchase_items ADD COLUMN other_label VARCHAR(200)")
                        )
                    if "iva_rate" not in pi_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE purchase_items ADD COLUMN iva_rate "
                                "NUMERIC(10,6) NOT NULL DEFAULT 0"
                            )
                        )
                    if "line_iva" not in pi_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE purchase_items ADD COLUMN line_iva "
                                "NUMERIC(14,4) NOT NULL DEFAULT 0"
                            )
                        )
                sup_sqlite = conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name='suppliers'")
                ).first()
                if sup_sqlite:
                    sup_cols = {
                        str(row[1])
                        for row in conn.execute(text("PRAGMA table_info(suppliers)")).fetchall()
                    }
                    if "tax_regime" not in sup_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE suppliers "
                                "ADD COLUMN tax_regime VARCHAR(20) NOT NULL DEFAULT 'common'"
                            )
                        )
                    if "income_tax_declarant" not in sup_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE suppliers "
                                "ADD COLUMN income_tax_declarant BOOLEAN NOT NULL DEFAULT 1"
                            )
                        )
                    if "default_withholding_operation" not in sup_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE suppliers "
                                "ADD COLUMN default_withholding_operation VARCHAR(20) NOT NULL DEFAULT 'purchase'"
                            )
                        )
                    if "default_withholding_percent" not in sup_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE suppliers ADD COLUMN default_withholding_percent NUMERIC(8,4)"
                            )
                        )
                pur_sqlite = conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name='purchases'")
                ).first()
                if pur_sqlite:
                    pur_cols = {
                        str(row[1])
                        for row in conn.execute(text("PRAGMA table_info(purchases)")).fetchall()
                    }
                    if "withholding_operation_type" not in pur_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE purchases "
                                "ADD COLUMN withholding_operation_type VARCHAR(20)"
                            )
                        )
                    if "withholding_source_rate" not in pur_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE purchases "
                                "ADD COLUMN withholding_source_rate NUMERIC(10,6)"
                            )
                        )
                    if "withholding_source_amount" not in pur_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE purchases "
                                "ADD COLUMN withholding_source_amount NUMERIC(14,4)"
                            )
                        )
                users_sqlite = conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
                ).first()
                if users_sqlite:
                    user_cols = {
                        str(row[1])
                        for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()
                    }
                    if "role" not in user_cols:
                        conn.execute(
                            text(
                                "ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'mesero'"
                            )
                        )
                return
            conn.execute(text("ALTER TABLE IF EXISTS inventory_products ALTER COLUMN unit DROP NOT NULL"))
            conn.execute(text("ALTER TABLE IF EXISTS inventory_products DROP COLUMN IF EXISTS reorder_point"))
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS menu_items "
                    "ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"
                )
            )
            conn.execute(
                text("ALTER TABLE IF EXISTS menu_items DROP COLUMN IF EXISTS image_url")
            )
            conn.execute(text("ALTER TABLE IF EXISTS suppliers DROP COLUMN IF EXISTS email"))
            conn.execute(text("ALTER TABLE IF EXISTS suppliers DROP COLUMN IF EXISTS notes"))
            conn.execute(text("ALTER TABLE IF EXISTS purchases DROP COLUMN IF EXISTS invoice_number"))
            conn.execute(
                text("ALTER TABLE IF EXISTS purchase_items ADD COLUMN IF NOT EXISTS supplier_id INTEGER")
            )
            conn.execute(
                text("ALTER TABLE IF EXISTS purchase_items ADD COLUMN IF NOT EXISTS other_label VARCHAR(200)")
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS purchase_items ADD COLUMN IF NOT EXISTS iva_rate "
                    "NUMERIC(10, 6) NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS purchase_items ADD COLUMN IF NOT EXISTS line_iva "
                    "NUMERIC(14, 4) NOT NULL DEFAULT 0"
                )
            )
            try:
                conn.execute(
                    text("ALTER TABLE purchase_items ALTER COLUMN product_id DROP NOT NULL")
                )
            except Exception:  # noqa: S110
                pass
            conn.execute(
                text("ALTER TABLE IF EXISTS sales ADD COLUMN IF NOT EXISTS customer_id INTEGER")
            )
            conn.execute(
                text("ALTER TABLE IF EXISTS pos_orders ADD COLUMN IF NOT EXISTS waiter_id INTEGER")
            )
            conn.execute(
                text("ALTER TABLE IF EXISTS sales ADD COLUMN IF NOT EXISTS waiter_id INTEGER")
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS suppliers "
                    "ADD COLUMN IF NOT EXISTS gender VARCHAR NOT NULL DEFAULT 'male'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS waiters "
                    "ADD COLUMN IF NOT EXISTS gender VARCHAR NOT NULL DEFAULT 'male'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS waiters "
                    "ADD COLUMN IF NOT EXISTS user_id INTEGER"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS customers "
                    "ADD COLUMN IF NOT EXISTS gender VARCHAR NOT NULL DEFAULT 'male'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS recipes "
                    "ADD COLUMN IF NOT EXISTS unit VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS users "
                    "ADD COLUMN IF NOT EXISTS full_name VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS users "
                    "ADD COLUMN IF NOT EXISTS profile_photo_url TEXT"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS users "
                    "ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'mesero'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS pos_tables "
                    "ADD COLUMN IF NOT EXISTS section VARCHAR NOT NULL DEFAULT 'ENTRADA'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS pos_orders "
                    "ADD COLUMN IF NOT EXISTS utility_total NUMERIC(14, 2) NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS sales "
                    "ADD COLUMN IF NOT EXISTS utility_total NUMERIC(14, 2) NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS sales "
                    "ADD COLUMN IF NOT EXISTS payment_method VARCHAR(32)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS reservations "
                    "DROP CONSTRAINT IF EXISTS uq_reservations_date"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS reservations "
                    "ADD COLUMN IF NOT EXISTS google_event_id VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS suppliers "
                    "ADD COLUMN IF NOT EXISTS tax_regime VARCHAR(20) NOT NULL DEFAULT 'common'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS suppliers "
                    "ADD COLUMN IF NOT EXISTS income_tax_declarant BOOLEAN NOT NULL DEFAULT TRUE"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS suppliers "
                    "ADD COLUMN IF NOT EXISTS default_withholding_operation VARCHAR(20) "
                    "NOT NULL DEFAULT 'purchase'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS suppliers "
                    "ADD COLUMN IF NOT EXISTS default_withholding_percent NUMERIC(8, 4)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS purchases "
                    "ADD COLUMN IF NOT EXISTS withholding_operation_type VARCHAR(20)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS purchases "
                    "ADD COLUMN IF NOT EXISTS withholding_source_rate NUMERIC(10, 6)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE IF EXISTS purchases "
                    "ADD COLUMN IF NOT EXISTS withholding_source_amount NUMERIC(14, 4)"
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS supplier_ingredients (
                        id SERIAL PRIMARY KEY,
                        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
                        product_id INTEGER NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
                        CONSTRAINT uq_supplier_ingredient UNIQUE (supplier_id, product_id)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_supplier_ingredients_supplier_id "
                    "ON supplier_ingredients (supplier_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_supplier_ingredients_product_id "
                    "ON supplier_ingredients (product_id)"
                )
            )
    except Exception as exc:
        logger.warning("Auto-migration skipped/failed: %s", exc)


@app.on_event("startup")
def _init_db() -> None:
    if os.getenv("AUTO_CREATE_TABLES", "1") != "1":
        return
    try:
        models.Base.metadata.create_all(bind=db.engine)
        _auto_migrate_schema()
        seed_staff.run_if_enabled()
        if os.getenv("SYNC_WAITER_FICHAS", "1") != "0":
            s = Session(bind=db.engine)
            try:
                n_l, n_c = personnel.sync_waiter_links_for_staff_users(s)
                s.commit()
                if n_l or n_c:
                    logger.info(
                        "startup: fichas mesero vinculadas=%s creadas=%s",
                        n_l,
                        n_c,
                    )
            except Exception:
                s.rollback()
                logger.exception("SYNC_WAITER_FICHAS al iniciar falló")
            finally:
                s.close()
    except OperationalError as exc:
        database_url = os.getenv(
            "DATABASE_URL",
            "(no definida; el backend usa por defecto socket local postgresql://postgres@/girona_dev — define DATABASE_URL o crea girona-back/.env)",
        )
        logger.error("Database connection failed. Check DATABASE_URL and Postgres auth.")
        logger.error("DATABASE_URL=%s", database_url)
        if database_url.startswith("postgresql:///") or database_url.startswith("postgres:///"):
            logger.error(
                "Hint: this URL uses a local Unix socket; ensure Postgres is running locally (socket like /var/run/postgresql/.s.PGSQL.5432)."
            )
        logger.error("%s", exc)
        raise

app.include_router(auth.router)
app.include_router(menu.router)
app.include_router(inventory.router)
app.include_router(personnel.router)
app.include_router(pos.router)
app.include_router(sales.router)
app.include_router(reservations.router)
app.include_router(factus.router)
