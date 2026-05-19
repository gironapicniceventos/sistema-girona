export const POS_INC_RATE = 0.08;
/** Propina sugerida en prefactura (el cliente decide si la paga). */
export const POS_SUGGESTED_TIP_RATE = 0.1;

export type PosPrefacturaItem = {
  id: number;
  menu_item_id: number;
  name: string;
  category: string;
  zone: string;
  quantity: number | string;
  unit_price: number | string;
  tax_rate: number | string;
  discount_amount: number | string;
  courtesy: boolean;
  note?: string | null;
  line_subtotal?: number | string;
  line_tax?: number | string;
  line_total: number | string;
};

export type PosPrefacturaOrder = {
  id: number;
  table_id: number;
  status: string;
  subtotal: number | string;
  tax_total: number | string;
  discount_total: number | string;
  courtesy_total: number | string;
  service_total: number | string;
  total: number | string;
  opened_at: string;
  items: PosPrefacturaItem[];
};

/** Precio en carta al cliente: IVA 8% incluido → base imponible por unidad (uso interno al crear pedido). */
export function grossUnitFromMenuPrice(menuPrice: number): number {
  const g = Number(menuPrice) || 0;
  return g > 0 ? Math.round(g / (1 + POS_INC_RATE)) : 0;
}

export function lineItemBase(item: PosPrefacturaItem): number {
  if (item.courtesy) return 0;
  const ls = Number(item.line_subtotal);
  if (Number.isFinite(ls) && !(ls < 0)) return ls;
  const u = Number(item.unit_price);
  const q = Number(item.quantity) || 1;
  const d = Number(item.discount_amount) || 0;
  return Math.max(u * q - d, 0);
}

/** Valor de línea como en la carta (IVA incluido, sin discriminar). */
export function lineItemCartGross(item: PosPrefacturaItem): number {
  if (item.courtesy) return 0;
  const tr = Number(item.tax_rate);
  if (tr > 0) {
    const lt = Number(item.line_total);
    if (Number.isFinite(lt)) return lt;
    return lineItemBase(item) + Math.round(lineItemBase(item) * tr);
  }
  const lt = Number(item.line_total);
  if (Number.isFinite(lt) && lt > 0) return lt;
  return Math.round(lineItemBase(item) * (1 + POS_INC_RATE));
}

export function lineItemCartUnit(item: PosPrefacturaItem): number {
  const qty = Math.max(1, Number(item.quantity) || 1);
  return item.courtesy ? 0 : Math.round(lineItemCartGross(item) / qty);
}

/** @deprecated Use lineItemCartGross */
export const lineItemGross = lineItemCartGross;

export type OrderCartTotalsOptions = {
  /** Si se omite, se usa propina sugerida o la registrada en el pedido. */
  tipAmount?: number | null;
  /** Por `item.id`: precio unitario carta (COP) mostrado al cliente antes de cerrar cuenta. */
  lineUnitCartOverrides?: Record<number, number>;
};

/** Precio unitario y total línea en prefactura (respeta sobrescritura por línea si existe). */
export function prefacturaDisplayUnit(
  item: PosPrefacturaItem,
  overrides?: Record<number, number> | null,
): number {
  if (item.courtesy) return 0;
  const o = overrides?.[item.id];
  if (o != null && Number.isFinite(o) && o >= 0) return Math.round(o);
  return lineItemCartUnit(item);
}

export function prefacturaDisplayLineGross(
  item: PosPrefacturaItem,
  overrides?: Record<number, number> | null,
): number {
  if (item.courtesy) return 0;
  const u = prefacturaDisplayUnit(item, overrides);
  const q = Math.max(1, Number(item.quantity) || 1);
  return Math.round(u * q);
}

/** Totales de prefactura: solo precios de carta + propina sugerida (sin desglose IVA). */
export function orderCartTotals(order: PosPrefacturaOrder, options?: OrderCartTotalsOptions) {
  const ovs = options?.lineUnitCartOverrides ?? null;
  const hasLineUnitOverrides = !!(ovs && Object.keys(ovs).length > 0);

  let subtotalCart = 0;
  for (const it of order.items) {
    subtotalCart += prefacturaDisplayLineGross(it, ovs ?? undefined);
  }
  const discount = Number(order.discount_total) || 0;
  const courtesy = Number(order.courtesy_total) || 0;
  const storedService = Number(order.service_total) || 0;
  const suggestedTip =
    storedService > 0 ? storedService : Math.round(subtotalCart * POS_SUGGESTED_TIP_RATE);
  const tipAmount =
    options?.tipAmount != null && Number.isFinite(options.tipAmount)
      ? Math.max(0, Math.round(options.tipAmount))
      : suggestedTip;

  return {
    subtotalCart,
    discount: hasLineUnitOverrides ? 0 : discount,
    courtesy: hasLineUnitOverrides ? 0 : courtesy,
    suggestedTip,
    tipAmount,
    totalWithTip: subtotalCart + tipAmount,
    totalWithSuggestedTip: subtotalCart + suggestedTip,
  };
}

/** Total a mostrar en listados POS (precio carta, sin propina). */
export function orderDisplayCartTotal(order: PosPrefacturaOrder): number {
  return orderCartTotals(order).subtotalCart;
}

/** Desglose fiscal: solo al cerrar / factura electrónica (no usar en prefactura). */
export function orderFiscalTotals(order: PosPrefacturaOrder) {
  const useStored =
    order.status === "closed" || order.items.some((i) => Number(i.tax_rate) > 0);
  if (useStored) {
    return {
      base: Number(order.subtotal) || 0,
      tax: Number(order.tax_total) || 0,
      discount: Number(order.discount_total) || 0,
      courtesy: Number(order.courtesy_total) || 0,
      service: Number(order.service_total) || 0,
      total: Number(order.total) || 0,
    };
  }
  let base = 0;
  for (const it of order.items) {
    base += lineItemBase(it);
  }
  const service = Number(order.service_total) || 0;
  return {
    base,
    tax: Math.round(base * POS_INC_RATE),
    discount: Number(order.discount_total) || 0,
    courtesy: Number(order.courtesy_total) || 0,
    service,
    total: Math.round(base * (1 + POS_INC_RATE)) + service,
  };
}

/** Vista de cobro / cierre: solo INC 8% (no IMPOCONSUMO ni ICUI en el POS). */
export function orderIncTaxPreview(order: PosPrefacturaOrder) {
  const fiscal = orderFiscalTotals(order);
  return {
    base: fiscal.base,
    incAmount: fiscal.tax,
    incPercent: Math.round(POS_INC_RATE * 100),
  };
}

/** @deprecated Use orderCartTotals for prefactura */
export function orderPrefacturaTotals(order: PosPrefacturaOrder) {
  const cart = orderCartTotals(order);
  return {
    base: cart.subtotalCart,
    tax: 0,
    discount: cart.discount,
    courtesy: cart.courtesy,
    service: cart.tipAmount,
    total: cart.totalWithTip,
  };
}

export function formatPlainCop(value: number) {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(value));
}
