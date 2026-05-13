from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship
from typing import Any

from .db import Base


def _factus_credit_note_meta_from_payload(response_payload: Any) -> tuple[int | None, str | None]:
    """Alineado con extract_credit_note_meta en factus_client (evita import circular models↔client)."""
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


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    profile_photo_url = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    # mesero | caja_mesero | admin | gerente | jefe_cocina | full_access
    role = Column(String(32), nullable=False, default="mesero")


class MenuItem(Base):
    __tablename__ = "menu_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    category = Column(String, index=True, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    description = Column(Text, nullable=True)
    ingredients = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True)


class InventoryProduct(Base):
    __tablename__ = "inventory_products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    sku = Column(String, unique=True, index=True, nullable=True)
    kind = Column(String, index=True, nullable=False, default="ingredient")
    unit = Column(String, nullable=True)

    on_hand = Column(Numeric(14, 4), nullable=False, default=0)

    average_cost = Column(Numeric(14, 4), nullable=False, default=0)
    last_cost = Column(Numeric(14, 4), nullable=False, default=0)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    movements = relationship("StockMovement", back_populates="product")
    purchase_items = relationship("PurchaseItem", back_populates="product")
    recipe_items = relationship("RecipeItem", back_populates="product")
    supplier_links = relationship("SupplierIngredient", back_populates="product")


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("inventory_products.id"), index=True, nullable=False)
    movement_type = Column(String, index=True, nullable=False)  # in|out|adjust
    quantity = Column(Numeric(14, 4), nullable=False)
    unit_cost = Column(Numeric(14, 4), nullable=True)

    reason = Column(String, nullable=True)
    reference_type = Column(String, index=True, nullable=True)  # purchase|sale|manual
    reference_id = Column(Integer, index=True, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    product = relationship("InventoryProduct", back_populates="movements")


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    phone = Column(String, nullable=True)
    gender = Column(String, nullable=False, default="male")
    # Persona jurídica / régimen común vs persona natural (afecta retención fuente junto al indicador siguiente)
    tax_regime = Column(String(20), nullable=False, default="common")
    # Solo relevante cuando tax_regime == "natural"; en común se asume declarante
    income_tax_declarant = Column(Boolean, nullable=False, default=True)
    # Valor por defecto para retención (compra bienes vs servicios) al cargar orden en Inventario
    default_withholding_operation = Column(String(20), nullable=False, default="purchase")
    # Porcentaje nominal de retención (ej. 2.5 = 2,5 %); null = usar tablas legales según régimen/declarante
    default_withholding_percent = Column(Numeric(8, 4), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    purchases = relationship("Purchase", back_populates="supplier")
    ingredient_links = relationship(
        "SupplierIngredient", back_populates="supplier", cascade="all, delete-orphan"
    )


class SupplierIngredient(Base):
    __tablename__ = "supplier_ingredients"
    __table_args__ = (
        UniqueConstraint("supplier_id", "product_id", name="uq_supplier_ingredient"),
    )

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(
        Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id = Column(
        Integer,
        ForeignKey("inventory_products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    supplier = relationship("Supplier", back_populates="ingredient_links")
    product = relationship("InventoryProduct", back_populates="supplier_links")


class Purchase(Base):
    __tablename__ = "purchases"

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), index=True, nullable=True)
    purchased_at = Column(DateTime(timezone=True), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)

    total_cost = Column(Numeric(14, 4), nullable=False, default=0)
    # compra vs servicio (umbrales y % distintos para retención en la fuente)
    withholding_operation_type = Column(String(20), nullable=True)
    # fracción, p. ej. 0.025; null si no hubo retención
    withholding_source_rate = Column(Numeric(10, 6), nullable=True)
    withholding_source_amount = Column(Numeric(14, 4), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    supplier = relationship("Supplier", back_populates="purchases")
    items = relationship("PurchaseItem", back_populates="purchase", cascade="all, delete-orphan")


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), index=True, nullable=False)
    product_id = Column(Integer, ForeignKey("inventory_products.id"), index=True, nullable=True)
    # Texto de línea "Otros" (gasto / compra que no afecta inventario); si hay producto, queda en null
    other_label = Column(String(200), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), index=True, nullable=True)
    quantity = Column(Numeric(14, 4), nullable=False)
    unit_cost = Column(Numeric(14, 4), nullable=False)
    # Fracción IVA (0.19 = 19 %). line_total = (qty*unit_cost) + line_iva (total con IVA).
    iva_rate = Column(Numeric(10, 6), nullable=False, default=0)
    line_iva = Column(Numeric(14, 4), nullable=False, default=0)
    line_total = Column(Numeric(14, 4), nullable=False, default=0)

    purchase = relationship("Purchase", back_populates="items")
    product = relationship("InventoryProduct", back_populates="purchase_items")
    supplier = relationship("Supplier", foreign_keys=[supplier_id])

    @property
    def product_name(self) -> str | None:
        if (self.other_label or "").strip():
            return (self.other_label or "").strip()
        return self.product.name if self.product else None


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True, index=True)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), unique=True, index=True, nullable=False)
    yield_quantity = Column(Numeric(14, 4), nullable=False, default=1)
    unit = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    items = relationship("RecipeItem", back_populates="recipe", cascade="all, delete-orphan")


class RecipeItem(Base):
    __tablename__ = "recipe_items"

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), index=True, nullable=False)
    product_id = Column(Integer, ForeignKey("inventory_products.id"), index=True, nullable=False)
    quantity = Column(Numeric(14, 4), nullable=False)
    waste_pct = Column(Numeric(6, 4), nullable=False, default=0)  # 0.10 = 10%

    recipe = relationship("Recipe", back_populates="items")
    product = relationship("InventoryProduct", back_populates="recipe_items")


class PosTable(Base):
    __tablename__ = "pos_tables"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    section = Column(String, nullable=False, default="ENTRADA")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    orders = relationship("PosOrder", back_populates="table")


class Waiter(Base):
    __tablename__ = "waiters"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    gender = Column(String, nullable=False, default="male")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    orders = relationship("PosOrder", back_populates="waiter")
    sales = relationship("Sale", back_populates="waiter")


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    identity_document = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True, index=True)
    gender = Column(String, nullable=False, default="male")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    sales = relationship("Sale", back_populates="customer")


class PosOrder(Base):
    __tablename__ = "pos_orders"

    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("pos_tables.id"), nullable=False, index=True)
    waiter_id = Column(Integer, ForeignKey("waiters.id"), nullable=True, index=True)
    status = Column(String, nullable=False, index=True, default="open")  # open|sent|delivered|closed|void
    subtotal = Column(Numeric(14, 2), nullable=False, default=0)
    tax_total = Column(Numeric(14, 2), nullable=False, default=0)
    discount_total = Column(Numeric(14, 2), nullable=False, default=0)
    courtesy_total = Column(Numeric(14, 2), nullable=False, default=0)
    service_total = Column(Numeric(14, 2), nullable=False, default=0)
    utility_total = Column(Numeric(14, 2), nullable=False, default=0)
    total = Column(Numeric(14, 2), nullable=False, default=0)

    opened_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)

    table = relationship("PosTable", back_populates="orders")
    waiter = relationship("Waiter", back_populates="orders")
    items = relationship("PosOrderItem", back_populates="order", cascade="all, delete-orphan")
    sale = relationship("Sale", back_populates="order", uselist=False, cascade="all, delete-orphan")

    @property
    def sale_id(self) -> int | None:
        return self.sale.id if self.sale else None

    @property
    def electronic_invoice_status(self) -> str | None:
        if not self.sale or not self.sale.electronic_invoice:
            return None
        return self.sale.electronic_invoice.status

    @property
    def electronic_invoice_number(self) -> str | None:
        if not self.sale or not self.sale.electronic_invoice:
            return None
        return self.sale.electronic_invoice.factus_bill_number

    @property
    def waiter_name(self) -> str | None:
        if not self.waiter:
            return None
        return self.waiter.name


class PosOrderItem(Base):
    __tablename__ = "pos_order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("pos_orders.id"), nullable=False, index=True)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    zone = Column(String, nullable=False)  # kitchen|bar

    quantity = Column(Numeric(14, 2), nullable=False, default=1)
    unit_price = Column(Numeric(14, 2), nullable=False, default=0)
    tax_rate = Column(Numeric(6, 4), nullable=False, default=0)
    discount_amount = Column(Numeric(14, 2), nullable=False, default=0)
    courtesy = Column(Boolean, default=False)
    note = Column(Text, nullable=True)

    line_subtotal = Column(Numeric(14, 2), nullable=False, default=0)
    line_tax = Column(Numeric(14, 2), nullable=False, default=0)
    line_total = Column(Numeric(14, 2), nullable=False, default=0)

    sent_at = Column(DateTime(timezone=True), nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)

    order = relationship("PosOrder", back_populates="items")


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("pos_orders.id", ondelete="CASCADE"), unique=True, index=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), index=True, nullable=True)
    waiter_id = Column(Integer, ForeignKey("waiters.id"), index=True, nullable=True)
    subtotal = Column(Numeric(14, 2), nullable=False, default=0)
    tax_total = Column(Numeric(14, 2), nullable=False, default=0)
    discount_total = Column(Numeric(14, 2), nullable=False, default=0)
    courtesy_total = Column(Numeric(14, 2), nullable=False, default=0)
    service_total = Column(Numeric(14, 2), nullable=False, default=0)
    utility_total = Column(Numeric(14, 2), nullable=False, default=0)
    total = Column(Numeric(14, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # efectivo, tarjeta_credito, tarjeta_debito, transferencia, billetera, otro, tarjeta (legacy)
    payment_method = Column(String(32), nullable=True)

    order = relationship("PosOrder", back_populates="sale")
    customer = relationship("Customer", back_populates="sales")
    waiter = relationship("Waiter", back_populates="sales")
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")
    electronic_invoice = relationship(
        "ElectronicInvoice",
        back_populates="sale",
        uselist=False,
        cascade="all, delete-orphan",
    )

    @property
    def courtesy_count(self) -> int:
        if not self.order or not self.order.items:
            return 0
        return sum(1 for item in self.order.items if item.courtesy)

    @property
    def discount_count(self) -> int:
        if not self.order or not self.order.items:
            return 0
        return sum(1 for item in self.order.items if item.discount_amount > 0)

    @property
    def electronic_invoice_status(self) -> str | None:
        if not self.electronic_invoice:
            return None
        return self.electronic_invoice.status

    @property
    def electronic_invoice_number(self) -> str | None:
        if not self.electronic_invoice:
            return None
        return self.electronic_invoice.factus_bill_number

    @property
    def factus_credit_note_number(self) -> str | None:
        inv = self.electronic_invoice
        if not inv:
            return None
        _, num = _factus_credit_note_meta_from_payload(inv.response_payload)
        return num

    @property
    def electronic_invoice_cufe(self) -> str | None:
        if not self.electronic_invoice:
            return None
        return self.electronic_invoice.cufe

    @property
    def electronic_invoice_qr_url(self) -> str | None:
        if not self.electronic_invoice:
            return None
        return self.electronic_invoice.qr_url

    @property
    def electronic_invoice_environment(self) -> str | None:
        if not self.electronic_invoice:
            return None
        return self.electronic_invoice.environment

    @property
    def electronic_invoice_email_status(self) -> str | None:
        if not self.electronic_invoice:
            return None
        payload = self.electronic_invoice.response_payload
        if not isinstance(payload, dict):
            return "not_requested"
        delivery = payload.get("email_delivery")
        if not isinstance(delivery, dict):
            return "not_requested"
        if delivery.get("ok") is True:
            return "sent"
        if delivery.get("ok") is False:
            return "failed"
        if delivery.get("requested"):
            return "requested"
        return "not_requested"

    @property
    def electronic_invoice_email_address(self) -> str | None:
        if not self.electronic_invoice:
            return None
        payload = self.electronic_invoice.response_payload
        if not isinstance(payload, dict):
            return None
        delivery = payload.get("email_delivery")
        if not isinstance(delivery, dict):
            return None
        email = delivery.get("email")
        if not isinstance(email, str) or not email.strip():
            return None
        return email.strip()

    @property
    def electronic_invoice_email_error(self) -> str | None:
        if not self.electronic_invoice:
            return None
        payload = self.electronic_invoice.response_payload
        if not isinstance(payload, dict):
            return None
        delivery = payload.get("email_delivery")
        if not isinstance(delivery, dict):
            return None
        error = delivery.get("error")
        if not isinstance(error, str) or not error.strip():
            return None
        return error.strip()


class ElectronicInvoice(Base):
    __tablename__ = "electronic_invoices"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(
        Integer,
        ForeignKey("sales.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    provider = Column(String, nullable=False, default="factus")
    environment = Column(String, nullable=False, default="sandbox")
    status = Column(String, nullable=False, default="pending")  # pending|issued|failed|voided
    reference_code = Column(String, nullable=True, unique=True, index=True)
    factus_bill_id = Column(Integer, nullable=True)
    factus_bill_number = Column(String, nullable=True, index=True)
    cufe = Column(String, nullable=True, index=True)
    qr_url = Column(Text, nullable=True)
    request_payload = Column(JSON, nullable=True)
    response_payload = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    sale = relationship("Sale", back_populates="electronic_invoice")


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id", ondelete="CASCADE"), index=True, nullable=False)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), index=True, nullable=False)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    quantity = Column(Numeric(14, 2), nullable=False, default=0)
    unit_price = Column(Numeric(14, 2), nullable=False, default=0)
    tax_rate = Column(Numeric(6, 4), nullable=False, default=0)
    line_subtotal = Column(Numeric(14, 2), nullable=False, default=0)
    line_tax = Column(Numeric(14, 2), nullable=False, default=0)
    line_total = Column(Numeric(14, 2), nullable=False, default=0)

    sale = relationship("Sale", back_populates="items")


class Reservation(Base):
    __tablename__ = "reservations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    reservation_date = Column(Date, nullable=False, index=True)
    reservation_time = Column(String, nullable=False)
    party_size = Column(Integer, nullable=False)
    google_event_id = Column(String, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
