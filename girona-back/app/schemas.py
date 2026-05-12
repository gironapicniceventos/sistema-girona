from decimal import Decimal
from datetime import date, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: str | None = None
    profile_photo_url: str | None = None

    class Config:
        orm_mode = True


class UserProfileOut(BaseModel):
    id: int
    email: EmailStr
    name: str
    profile_photo_url: str
    role: str = "mesero"


class UserProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    profile_photo_url: str | None = Field(default=None, max_length=8_000_000)

class Token(BaseModel):
    access_token: str
    token_type: str


class InventoryProductKind(str, Enum):
    ingredient = "ingredient"
    material = "material"
    product = "product"


class StockMovementType(str, Enum):
    inbound = "in"
    outbound = "out"
    adjust = "adjust"


class InventoryProductBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sku: str | None = Field(default=None, max_length=100)
    kind: InventoryProductKind = InventoryProductKind.ingredient
    unit: str | None = Field(default=None, max_length=20)
    is_active: bool = True


class InventoryProductCreate(InventoryProductBase):
    initial_quantity: Decimal = Field(gt=0)
    total_cost: Decimal = Field(ge=0)


class InventoryProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    sku: str | None = Field(default=None, max_length=100)
    kind: InventoryProductKind | None = None
    unit: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None
    on_hand: Decimal | None = None
    total_cost: Decimal | None = Field(default=None, ge=0)


class InventoryProductOut(InventoryProductBase):
    id: int
    on_hand: Decimal
    average_cost: Decimal
    last_cost: Decimal
    created_at: datetime

    class Config:
        orm_mode = True


class StockMovementCreate(BaseModel):
    product_id: int
    movement_type: StockMovementType
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal | None = None
    reason: str | None = Field(default=None, max_length=200)
    reference_type: str | None = Field(default=None, max_length=50)
    reference_id: int | None = None


class StockMovementOut(BaseModel):
    id: int
    product_id: int
    movement_type: str
    quantity: Decimal
    unit_cost: Decimal | None
    reason: str | None
    reference_type: str | None
    reference_id: int | None
    created_at: datetime

    class Config:
        orm_mode = True


class SupplierBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    gender: str = Field(default="male", max_length=20)
    is_active: bool = True
    # common = régimen común; natural = persona natural (declarante o no según income_tax_declarant)
    tax_regime: Literal["common", "natural"] = "common"
    income_tax_declarant: bool = True
    default_withholding_operation: Literal["purchase", "service"] = "purchase"
    # null = tasas por tabla legal; si se informa, es el % nominal (2.5 = 2,5 %)
    default_withholding_percent: Decimal | None = Field(default=None, ge=0, le=100)


class SupplierCreate(SupplierBase):
    ingredient_product_ids: list[int] = Field(default_factory=list)


class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    gender: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None
    tax_regime: Literal["common", "natural"] | None = None
    income_tax_declarant: bool | None = None
    default_withholding_operation: Literal["purchase", "service"] | None = None
    default_withholding_percent: Decimal | None = Field(default=None, ge=0, le=100)
    ingredient_product_ids: list[int] | None = None


class SupplierOut(SupplierBase):
    id: int
    created_at: datetime
    ingredient_product_ids: list[int] = Field(default_factory=list)

    class Config:
        orm_mode = True


class PurchaseItemCreate(BaseModel):
    # True: gasto "Otros" (solo registro y egreso, no toca stock ni productos de inventario)
    is_other_expense: bool = False
    product_id: int | None = None
    product_name: str | None = Field(default=None, max_length=200)
    product_kind: InventoryProductKind | None = None
    unit: str | None = Field(default=None, max_length=20)
    supplier_id: int | None = None
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal = Field(ge=0)
    # Fracción 0–1 sobre el subtotal (qty*unit_cost), costo inventario sin IVA.
    iva_rate: Decimal | None = Field(default=None, ge=0, le=1)


class PurchaseCreate(BaseModel):
    supplier_id: int | None = None
    purchased_at: datetime | None = None
    received_at: datetime | None = None
    withholding_operation_type: Literal["purchase", "service"] | None = None
    items: list[PurchaseItemCreate] = Field(min_length=1)


class PurchaseItemOut(BaseModel):
    id: int
    product_id: int | None = None
    product_name: str | None
    is_other_expense: bool = False
    supplier_id: int | None
    quantity: Decimal
    unit_cost: Decimal
    iva_rate: Decimal
    line_iva: Decimal
    line_subtotal: Decimal
    line_total: Decimal

    class Config:
        orm_mode = True


class PurchaseOut(BaseModel):
    id: int
    supplier_id: int | None
    supplier_name: str | None = None
    purchased_at: datetime | None
    received_at: datetime | None
    # Total orden (suma líneas con IVA).
    total_cost: Decimal
    subtotal_net: Decimal
    total_iva: Decimal
    withholding_operation_type: str | None = None
    withholding_source_rate: Decimal | None = None
    withholding_source_amount: Decimal | None = None
    created_at: datetime
    items: list[PurchaseItemOut]

    class Config:
        orm_mode = True


class RecipeItemUpsert(BaseModel):
    product_id: int
    quantity: Decimal = Field(gt=0)
    waste_pct: Decimal = Field(default=Decimal("0"), ge=0)


class RecipeUpsert(BaseModel):
    yield_quantity: Decimal = Field(default=Decimal("1"), gt=0)
    notes: str | None = None
    items: list[RecipeItemUpsert] = Field(default_factory=list)


class RecipeItemOut(BaseModel):
    id: int
    product_id: int
    quantity: Decimal
    waste_pct: Decimal

    class Config:
        orm_mode = True


class RecipeOut(BaseModel):
    id: int
    menu_item_id: int
    yield_quantity: Decimal
    unit: str | None = None
    notes: str | None
    created_at: datetime
    items: list[RecipeItemOut]

    class Config:
        orm_mode = True


class RecipeIngredientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    unit: str | None = Field(default=None, max_length=5)
    quantity: Decimal = Field(gt=0, description="Cantidad por lote (rendimiento)")


class ReservationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=5, max_length=30)
    reservation_date: date
    reservation_time: str = Field(min_length=3, max_length=10)
    party_size: int = Field(gt=0, le=50)


class ReservationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, min_length=5, max_length=30)
    reservation_date: date | None = None
    reservation_time: str | None = Field(default=None, min_length=3, max_length=10)
    party_size: int | None = Field(default=None, gt=0, le=50)


class ReservationOut(BaseModel):
    id: int
    name: str
    phone: str
    reservation_date: date
    reservation_time: str
    party_size: int
    created_at: datetime

    class Config:
        orm_mode = True


class RecipeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    yield_quantity: Decimal = Field(default=Decimal("1"), gt=0)
    unit: str | None = Field(default=None, max_length=5)
    ingredients: list[RecipeIngredientCreate] = Field(default_factory=list)
    notes: str | None = None


class RecipeIngredientOut(BaseModel):
    name: str
    unit: str | None
    quantity: Decimal


class RecipeCatalogOut(BaseModel):
    """Catálogo de recetas; menu_category en 'Recetas' indica preparación solo de inventario."""

    id: int
    menu_item_id: int
    name: str
    yield_quantity: Decimal
    unit: str | None = None
    created_at: datetime
    ingredients: list[RecipeIngredientOut] = Field(default_factory=list)
    menu_category: str = ""
    menu_item_is_active: bool = True

    class Config:
        orm_mode = True


class ConsumeSaleRequest(BaseModel):
    menu_item_id: int
    quantity: Decimal = Field(gt=0)


class ConsumeSaleResult(BaseModel):
    menu_item_id: int
    quantity: Decimal
    total_cost: Decimal
    movements_created: int


class PosTableCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    section: str = Field(default="ENTRADA", min_length=1, max_length=100)


class PosTableOut(BaseModel):
    id: int
    name: str
    section: str
    is_active: bool
    created_at: datetime

    class Config:
        orm_mode = True


class PosOrderItemCreate(BaseModel):
    menu_item_id: int
    quantity: Decimal = Field(gt=0)
    unit_price: Decimal = Field(ge=0)
    tax_rate: Decimal = Field(ge=0, le=Decimal("1"))
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    courtesy: bool = False
    note: str | None = None


class PosOrderCreate(BaseModel):
    table_id: int
    service_total: Decimal = Field(default=Decimal("0"), ge=0)
    waiter_id: int | None = None
    items: list[PosOrderItemCreate] = Field(min_length=1)


class PosOrderAppendItems(BaseModel):
    items: list[PosOrderItemCreate] = Field(min_length=1)


class PosOrderItemOut(BaseModel):
    id: int
    menu_item_id: int
    name: str
    category: str
    zone: str
    quantity: Decimal
    unit_price: Decimal
    tax_rate: Decimal
    discount_amount: Decimal
    courtesy: bool
    note: str | None
    line_subtotal: Decimal
    line_tax: Decimal
    line_total: Decimal
    sent_at: datetime | None
    delivered_at: datetime | None

    class Config:
        orm_mode = True


class PosOrderOut(BaseModel):
    id: int
    table_id: int
    waiter_id: int | None
    waiter_name: str | None = None
    sale_id: int | None = None
    status: str
    electronic_invoice_status: str | None = None
    electronic_invoice_number: str | None = None
    subtotal: Decimal
    tax_total: Decimal
    discount_total: Decimal
    courtesy_total: Decimal
    service_total: Decimal
    utility_total: Decimal
    total: Decimal
    opened_at: datetime
    sent_at: datetime | None
    delivered_at: datetime | None
    closed_at: datetime | None
    items: list[PosOrderItemOut]

    class Config:
        orm_mode = True


class PosOrderDeliver(BaseModel):
    delivered: bool = True
    waiter_id: int | None = None


class PosOrderClose(BaseModel):
    customer_id: int | None = None
    customer_name: str | None = Field(default=None, min_length=1, max_length=200)
    customer_identity_document: str | None = Field(default=None, min_length=1, max_length=100)
    customer_phone: str | None = Field(default=None, max_length=50)
    apply_inc: bool = False
    service_total: Decimal | None = Field(default=None, ge=0)
    utility_total: Decimal | None = Field(default=None, ge=0)
    payment_method: str | None = Field(
        default=None,
        max_length=32,
        description=(
            "efectivo|datofono|qr|nequi|tarjeta_credito|tarjeta_debito|transferencia|billetera|otro|tarjeta(legacy)"
        ),
    )


class SaleItemOut(BaseModel):
    id: int
    menu_item_id: int
    name: str
    category: str
    quantity: Decimal
    unit_price: Decimal
    tax_rate: Decimal
    line_subtotal: Decimal
    line_tax: Decimal
    line_total: Decimal

    class Config:
        orm_mode = True


class SaleOut(BaseModel):
    id: int
    order_id: int
    customer_id: int | None
    waiter_id: int | None
    payment_method: str | None = None
    subtotal: Decimal
    tax_total: Decimal
    discount_total: Decimal
    courtesy_total: Decimal
    discount_count: int = 0
    courtesy_count: int = 0
    service_total: Decimal
    utility_total: Decimal
    total: Decimal
    created_at: datetime
    electronic_invoice_status: str | None = None
    electronic_invoice_number: str | None = None
    electronic_invoice_environment: str | None = None
    electronic_invoice_cufe: str | None = None
    electronic_invoice_qr_url: str | None = None
    electronic_invoice_email_status: str | None = None
    electronic_invoice_email_address: str | None = None
    electronic_invoice_email_error: str | None = None
    factus_credit_note_number: str | None = None
    items: list[SaleItemOut]

    class Config:
        orm_mode = True


class ElectronicInvoiceOut(BaseModel):
    id: int
    sale_id: int
    provider: str
    environment: str
    status: str
    reference_code: str | None
    factus_bill_id: int | None
    factus_bill_number: str | None
    cufe: str | None
    qr_url: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    factus_credit_note_id: int | None = None
    factus_credit_note_number: str | None = None

    class Config:
        orm_mode = True


class FactusCreditNoteRequest(BaseModel):
    """Anular factura electrónica validada vía nota crédito (Factus crear-y-validar)."""

    numbering_range_id: int | None = None
    observation: str | None = Field(default=None, max_length=250)
    send_email: bool = False


class FactusIssueInvoiceRequest(BaseModel):
    customer_id: int | None = None
    customer_name: str | None = Field(default=None, min_length=1, max_length=200)
    customer_identity_document: str | None = Field(default=None, min_length=1, max_length=100)
    customer_phone: str | None = Field(default=None, max_length=50)
    customer_email: str | None = Field(default=None, max_length=200)
    numbering_range_id: int | None = None


class FactusEmailSendRequest(BaseModel):
    email: str = Field(min_length=5, max_length=200)


class FactusRangeOut(BaseModel):
    id: int
    prefix: str | None = None
    from_number: int | None = None
    to_number: int | None = None
    current: int | None = None
    resolution_number: str | None = None
    is_active: bool | None = None


class FactusHealthOut(BaseModel):
    ok: bool
    environment: str
    api_base_url: str
    numbering_ranges: list[FactusRangeOut] = Field(default_factory=list)


class SalesByProductOut(BaseModel):
    menu_item_id: int
    name: str
    category: str
    quantity: Decimal
    total: Decimal


class SalesByCategoryOut(BaseModel):
    category: str
    quantity: Decimal
    total: Decimal


class SalesByWaiterOut(BaseModel):
    waiter_id: int | None
    name: str
    quantity: Decimal
    service_total: Decimal
    total: Decimal


class SalesByTableOut(BaseModel):
    table_id: int | None
    name: str | None
    is_active: bool | None
    quantity: Decimal
    total: Decimal


class SalesAdjustmentsByMonthOut(BaseModel):
    year: int
    month: int
    courtesy_count: int
    discount_count: int


class MenuItemIngredient(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    unit: str | None = Field(default=None, max_length=20)
    # Histórico/seed puede tener 0 en filas opcionales; la API sigue validando escritura en menu.py
    weight: Decimal = Field(ge=0, description="Cantidad consumida (ej. gramos) por porción")
    price: Decimal
    total: Decimal | None = None


class MenuItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=100)
    price: Decimal
    description: str | None = None
    ingredients: list[MenuItemIngredient] | list[str] | None = None


class MenuItemCreate(MenuItemBase):
    pass


class MenuItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    price: Decimal | None = None
    description: str | None = None
    ingredients: list[MenuItemIngredient] | list[str] | None = None


class MenuItemOut(MenuItemBase):
    id: int

    class Config:
        orm_mode = True


class WaiterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    gender: str = Field(default="male", max_length=20)
    is_active: bool = True


class WaiterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    gender: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None


class WaiterOut(BaseModel):
    id: int
    name: str
    gender: str
    is_active: bool
    created_at: datetime

    class Config:
        orm_mode = True


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    identity_document: str = Field(min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    gender: str = Field(default="male", max_length=20)
    is_active: bool = True


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    identity_document: str | None = Field(default=None, min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    gender: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None


class CustomerOut(BaseModel):
    id: int
    name: str
    identity_document: str
    phone: str | None
    gender: str
    is_active: bool
    created_at: datetime

    class Config:
        orm_mode = True
