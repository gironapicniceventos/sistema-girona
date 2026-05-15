"use client";

import { CheckIcon, SearchIcon, TrashIcon } from "@/assets/icons";
import { DownloadIcon } from "@/components/Tables/icons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableScroll } from "@/components/ui/scroll-table";
import { Tooltip } from "@/components/ui/tooltip";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import jsPDF from "jspdf";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HiOutlineCash } from "react-icons/hi";
import { RiDrinks2Fill, RiProhibited2Line, RiRestaurantLine } from "react-icons/ri";
import { useSession } from "@/components/Auth/SessionContext";
import { getPosCategoryIcon } from "@/lib/pos-menu-category-icons";
import { formatApiErrorMessage } from "@/app/api/personnel/_utils";

dayjs.extend(utc);
dayjs.extend(timezone);

const COLOMBIA_TZ = "America/Bogota";
const INC_RATE = 0.08;
const BUSINESS_NAME = process.env.NEXT_PUBLIC_BUSINESS_NAME ?? "Girona";
const PREFACTURA_INC_FOOTNOTE =
  "Impuesto al consumo (INC), si aplica, forma parte del total a pagar y no se discrimina en este comprobante.";
const PAYMENT_METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "efectivo", label: "Efectivo" },
  { value: "datofono", label: "Datáfono" },
  { value: "qr", label: "QR" },
  { value: "nequi", label: "Nequi" },
];

function paymentMethodLabel(value: string) {
  return PAYMENT_METHOD_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** jsPDF fuente por defecto: latin-1 aproximado */
function pdfLatin1Safe(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const TABLE_SECTION_VALUES = [
  "ENTRADA",
  "LOBBY",
  "TERRAZA 1",
  "TERRAZA 2",
  "PREMIUM",
  "ROUSSE",
] as const;

type TableSectionValue = (typeof TABLE_SECTION_VALUES)[number];
type TableSectionFilter = TableSectionValue | "TODAS";

function parseTableNumberFromName(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10);
  const m = s.match(/(\d+)/);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

function sectionForTableNumber(n: number): TableSectionValue {
  if (!Number.isFinite(n) || n < 1) return "ENTRADA";
  if (n <= 10) return "ENTRADA";
  if (n <= 29) return "LOBBY";
  if (n <= 39) return "TERRAZA 1";
  if (n <= 49) return "TERRAZA 2";
  if (n <= 59) return "PREMIUM";
  return "ROUSSE";
}

type MenuItem = {
  id: number;
  name: string;
  category: string;
  price: string | number;
  description?: string | null;
  ingredients?: MenuIngredient[] | string[] | null;
};

type MenuIngredient = {
  name: string;
  unit: string;
  weight: string | number;
  price: string | number;
  total?: string | number;
};

type PosTable = {
  id: number;
  name: string;
  section?: string | null;
  is_active: boolean;
};

type Customer = {
  id: number;
  name: string;
  identity_document: string;
  phone?: string | null;
  is_active: boolean;
};

type Waiter = {
  id: number;
  name: string;
  is_active: boolean;
};

type PosOrderItemCreate = {
  menu_item_id: number;
  quantity: number;
  unit_price: number;
  tax_rate: number | null;
  discount_rate: number | null;
  courtesy: boolean;
  note?: string | null;
};

type PosOrderOut = {
  id: number;
  table_id: number;
  waiter_id?: number | null;
  waiter_name?: string | null;
  sale_id?: number | null;
  status: string;
  electronic_invoice_status?: string | null;
  electronic_invoice_number?: string | null;
  /** Medio de pago registrado al cerrar (si aplica). */
  payment_method?: string | null;
  subtotal: number | string;
  tax_total: number | string;
  discount_total: number | string;
  courtesy_total: number | string;
  service_total: number | string;
  utility_total?: number | string;
  total: number | string;
  opened_at: string;
  sent_at?: string | null;
  delivered_at?: string | null;
  closed_at?: string | null;
  items: Array<{
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
  }>;
};

function formatMoney(value: unknown) {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(num)) return String(value ?? "");
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(num);
}

/** Importe de línea sin INC para pre-factura (el INC solo en el total del pie). */
function preFacturaLineDisplayAmount(item: PosOrderOut["items"][number]): number {
  const sub = Number(item.line_subtotal);
  if (Number.isFinite(sub) && sub >= 0) return sub;
  const total = Number(item.line_total);
  const tax = Number(item.line_tax);
  if (Number.isFinite(total) && Number.isFinite(tax) && tax > 0 && total >= tax) {
    return Math.max(0, total - tax);
  }
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}

function parseCopAmount(value: string) {
  const rawInput = value.trim();
  if (!rawInput) return 0;

  let normalized = rawInput.replace(/\s/g, "");
  if (normalized.includes(".") && normalized.includes(",")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(/,/g, ".");
  }

  normalized = normalized.replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

/** Precio de venta en COP tal como en carta / menú (incluye INC 8% si aplica al precio mostrado). */
function menuItemSellPriceCop(price: string | number | null | undefined): number {
  if (typeof price === "number" && Number.isFinite(price)) {
    return Math.max(0, price);
  }
  return parseCopAmount(String(price ?? ""));
}

/**
 * Base unitaria sin INC para líneas del pedido: precio_carta / (1 + INC).
 * La grilla del menú en POS sigue usando menuItemSellPriceCop (precio carta).
 */
function posOrderNetUnitFromMenuGrossCop(grossCop: number): number {
  if (!Number.isFinite(grossCop) || grossCop <= 0) return 0;
  return Math.round(grossCop / (1 + INC_RATE));
}

function isPosOrderableMenuItem(item: MenuItem): boolean {
  return menuItemSellPriceCop(item.price) > 0;
}

const BAR_CATEGORY_KEYS = new Set(
  [
    "bebidas",
    "sodas",
    "gaseosas",
    "para el almuerzo",
    "cervezas nacionales",
    "cervezas internacionales",
    "micheladas",
    "licores y shots",
    "licores & shots",
    "cubetazos",
    "cocteleria",
    "vinos",
  ].map((v) => v.trim().toLowerCase()),
);

function categoryKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toColombiaTime(value?: string | null) {
  if (!value) return null;
  const hasTzOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  if (hasTzOffset) {
    const withOffset = dayjs(value);
    return withOffset.isValid() ? withOffset.tz(COLOMBIA_TZ) : null;
  }
  const asBogota = dayjs.tz(value, COLOMBIA_TZ);
  return asBogota.isValid() ? asBogota : null;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function categoryToId(scope: "rest" | "bar", category: string) {
  return `${scope}-cat-${categoryKey(category).replace(/[^a-z0-9]+/g, "-")}`;
}

function normalizeTableSection(rawSection?: string | null): TableSectionValue {
  const section = (rawSection ?? "").trim().toUpperCase();
  if ((TABLE_SECTION_VALUES as readonly string[]).includes(section)) {
    return section as TableSectionValue;
  }
  return "ENTRADA";
}

const ORDER_STATUS_META: Record<
  string,
  {
    label: string;
    className: string;
  }
> = {
  open: { label: "En curso", className: "bg-[#FFA70B]/[0.12] text-[#FFA70B]" },
  sent: { label: "Enviado", className: "bg-[#219653]/[0.08] text-[#219653]" },
  delivered: { label: "Entregado", className: "bg-[#219653]/[0.08] text-[#219653]" },
  closed: { label: "Pagado", className: "bg-[#1F2937]/10 text-[#1F2937]" },
  void: { label: "Anulado", className: "bg-[#D34053]/[0.12] text-[#D34053]" },
};

function orderStatusMeta(status: string) {
  return (
    ORDER_STATUS_META[status] ?? {
      label: status,
      className: "bg-gray-2 text-dark dark:bg-dark-3 dark:text-white",
    }
  );
}

/** Badge en la grilla POS: resalta pedido cerrado con factura DIAN emitida. */
function posOrderRowStatusMeta(order: PosOrderOut) {
  if (order.status === "closed" && order.electronic_invoice_status === "issued") {
    return {
      label: "Pagado · Facturado",
      className:
        "border border-green-200 bg-green-100 text-green-900 dark:border-green-800 dark:bg-green-900/45 dark:text-green-100",
    };
  }
  if (order.status === "closed") {
    return {
      label: "Pagado",
      className:
        "border border-emerald-200/80 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
    };
  }
  return orderStatusMeta(order.status);
}

function buildPosTicketPdf(order: PosOrderOut, tableName: string) {
  const doc = new jsPDF();
  const m = 14;
  const pageW = 196;
  let y = 18;
  const status = orderStatusMeta(order.status);
  const createdAt = toColombiaTime(order.opened_at);
  const closedAt = toColombiaTime(order.closed_at ?? null);

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(pdfLatin1Safe(BUSINESS_NAME), m, y);
  y += 8;
  doc.setFontSize(11);
  doc.text("COMPROBANTE POS — TICKET DE VENTA", m, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Pedido #${order.id}  |  Mesa: ${pdfLatin1Safe(tableName)}`, m, y);
  y += 5;
  doc.text(`Estado: ${pdfLatin1Safe(status.label)}`, m, y);
  y += 5;
  const when = closedAt?.isValid()
    ? closedAt
    : createdAt?.isValid()
      ? createdAt
      : null;
  doc.text(`Fecha: ${when?.isValid() ? when.format("DD/MM/YYYY HH:mm") : "—"}`, m, y);
  y += 5;

  if (order.status === "closed") {
    if (order.electronic_invoice_status === "issued" && order.electronic_invoice_number) {
      doc.setFont("helvetica", "bold");
      doc.text(
        `Factura electronica DIAN: ${pdfLatin1Safe(String(order.electronic_invoice_number))}`,
        m,
        y,
      );
      doc.setFont("helvetica", "normal");
      y += 5;
    } else if (order.electronic_invoice_status === "failed") {
      doc.text("Factura electronica: emision fallida (revisar en modulo de ventas).", m, y);
      y += 5;
    }
  }

  const payRaw = order.payment_method;
  if (payRaw && String(payRaw).trim()) {
    doc.text(
      `Medio de pago: ${pdfLatin1Safe(paymentMethodLabel(String(payRaw)))}`,
      m,
      y,
    );
    y += 5;
  }

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Producto", m, y);
  doc.text("Cant.", 128, y);
  doc.text("Total", pageW, y, { align: "right" });
  y += 2;
  doc.setLineWidth(0.3);
  doc.line(m, y, pageW, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  const lineTotalOf = (item: PosOrderOut["items"][number]) => Number(item.line_total ?? 0);

  for (const it of order.items) {
    const nameLines = doc.splitTextToSize(pdfLatin1Safe(String(it.name)), 100);
    const blockH = Math.max(nameLines.length * 4.8, 6);
    if (y + blockH > 275) {
      doc.addPage();
      y = 20;
    }
    const rowTop = y;
    nameLines.forEach((line: string, i: number) => {
      doc.text(line, m, rowTop + 4 + i * 4.8);
    });
    doc.text(String(it.quantity), 128, rowTop + 4);
    doc.text(formatMoney(lineTotalOf(it)), pageW, rowTop + 4, { align: "right" });
    y = rowTop + blockH + 2;
  }

  y += 4;
  const addTotalRow = (label: string, value: number | string, bold?: boolean) => {
    if (y > 285) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, m, y);
    doc.text(formatMoney(value), pageW, y, { align: "right" });
    y += 6;
    doc.setFont("helvetica", "normal");
  };
  addTotalRow("Subtotal", order.subtotal);
  addTotalRow("IVA / impuesto lineas", order.tax_total);
  addTotalRow("Descuentos", order.discount_total);
  addTotalRow("Cortesias", order.courtesy_total);
  addTotalRow("Servicio", order.service_total);
  addTotalRow("Utilidad", order.utility_total ?? 0);
  addTotalRow("TOTAL", order.total, true);

  doc.setFontSize(8);
  const foot = doc.splitTextToSize(
    pdfLatin1Safe(
      "Documento interno POS a nombre de la empresa. Si se emitio factura electronica, esa es el titulo valorado ante la DIAN. " +
        PREFACTURA_INC_FOOTNOTE,
    ),
    pageW - m,
  );
  y += 2;
  for (const ln of foot) {
    if (y > 285) {
      doc.addPage();
      y = 20;
    }
    doc.text(ln, m, y);
    y += 4;
  }
  return doc;
}

type PreFacturaPreview = {
  subtotal: number;
  incTotal: number;
  serviceTotal: number;
  total: number;
};

function buildPreFacturaPdf(
  order: PosOrderOut,
  preview: PreFacturaPreview,
  tableName: string,
  paymentMethodValue: string,
) {
  const doc = new jsPDF();
  const m = 14;
  const pageW = 196;
  let y = 18;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(BUSINESS_NAME, m, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const noteLines = doc.splitTextToSize(
    "Pre-factura / comprobante de consumo. No reemplaza la factura electronica; si aplica, se emite via Factus al guardar pago con facturacion activada.",
    pageW - m,
  );
  doc.text(noteLines, m, y);
  y += noteLines.length * 4.5 + 2;

  const when = dayjs().tz(COLOMBIA_TZ).format("DD/MM/YYYY HH:mm");
  doc.setFontSize(10);
  doc.text(
    `Pedido #${order.id}  |  Mesa: ${tableName}  |  ${when}`,
    m,
    y,
  );
  y += 6;
  doc.text(
    `Medio de pago (preferencia): ${paymentMethodLabel(paymentMethodValue)}`,
    m,
    y,
  );
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Producto", m, y);
  doc.text("Cant.", 130, y);
  doc.text("Total", pageW, y, { align: "right" });
  y += 2;
  doc.setLineWidth(0.3);
  doc.line(m, y, pageW, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  for (const it of order.items) {
    const nameLines = doc.splitTextToSize(String(it.name), 100);
    const blockH = Math.max(nameLines.length * 4.8, 6);
    if (y + blockH > 275) {
      doc.addPage();
      y = 20;
    }
    const rowTop = y;
    nameLines.forEach((line: string, i: number) => {
      doc.text(line, m, rowTop + 4 + i * 4.8);
    });
    doc.text(String(it.quantity), 130, rowTop + 4);
    doc.text(formatMoney(preFacturaLineDisplayAmount(it)), pageW, rowTop + 4, { align: "right" });
    y = rowTop + blockH + 2;
  }

  y += 4;
  doc.setFontSize(10);
  const addTotalRow = (label: string, value: number, bold?: boolean) => {
    if (y > 285) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, m, y);
    doc.text(formatMoney(value), pageW, y, { align: "right" });
    y += 6;
    doc.setFont("helvetica", "normal");
  };
  addTotalRow("Total", preview.total, true);
  if (y > 275) {
    doc.addPage();
    y = 20;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const foot = doc.splitTextToSize(
    pdfLatin1Safe(PREFACTURA_INC_FOOTNOTE),
    pageW - m,
  );
  y += 2;
  for (const ln of foot) {
    if (y > 285) {
      doc.addPage();
      y = 20;
    }
    doc.text(ln, m, y);
    y += 4;
  }
  return doc;
}

// Modal para ver pedido existente
function ViewOrderModal({
  order,
  waiterDisplayName,
  onClose,
  canAddToOrder,
  onAddToOrder,
  canPayOrder,
  onPayOrder,
  deletingItemId,
  onDeleteItem,
  deleteSuccessMessage,
}: {
  order: PosOrderOut | null;
  waiterDisplayName?: string | null;
  onClose: () => void;
  canAddToOrder: boolean;
  onAddToOrder: (order: PosOrderOut) => void;
  canPayOrder: boolean;
  onPayOrder: (order: PosOrderOut) => void;
  deletingItemId: number | null;
  onDeleteItem: (order: PosOrderOut, itemId: number) => void;
  deleteSuccessMessage: string | null;
}) {
  if (!order) return null;
  const zoneLabel = (zone: string) => (zone === "bar" ? "Bar" : "Restaurante");
  const status = orderStatusMeta(order.status);
  const waiterTitle = (waiterDisplayName ?? order.waiter_name ?? "").trim();
  return (
    <div
      className="fixed inset-0 z-99 flex items-center justify-center bg-black/60 p-4 opacity-0 animate-[fadeIn_160ms_ease-out_forwards]"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-stroke bg-white shadow-2xl opacity-0 animate-[fadeIn_200ms_ease-out_60ms_forwards] dark:border-dark-3 dark:bg-gray-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stroke px-4 py-3 dark:border-dark-3">
          <div>
            <h3 className="text-base font-semibold text-dark dark:text-white">
              Pedido #{order.id}
              {waiterTitle ? (
                <span className="font-medium text-body-color dark:text-dark-6">
                  {" "}
                  · {waiterTitle}
                </span>
              ) : null}
            </h3>
            <p className="text-xs text-body-color dark:text-dark-6">
              Mesa: {order.table_id} · Estado: {status.label}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canAddToOrder ? (
              <button
                type="button"
                onClick={() => onAddToOrder(order)}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary/90"
              >
                Añadir pedido
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stroke px-3 py-1.5 text-sm font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3 space-y-3">
          {deleteSuccessMessage ? (
            <div className="flex items-center gap-2 rounded-lg border border-green/40 bg-green/10 px-3 py-2 text-sm font-medium text-green">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green text-xs font-bold text-white">
                ✓
              </span>
              <span>{deleteSuccessMessage}</span>
            </div>
          ) : null}
          {order.items.length === 0 ? (
            <p className="text-sm text-dark-6 dark:text-dark-6">Sin items.</p>
          ) : (
            order.items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-stroke bg-white p-3 text-sm text-dark shadow-sm dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{item.name}</div>
                    <div className="text-xs text-dark-6 dark:text-dark-6">
                      {item.category} · {zoneLabel(item.zone)}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-primary">
                    {formatMoney(Number(item.unit_price))}
                  </div>
                </div>
                <div className="mt-1 text-xs text-dark-6 dark:text-dark-6">
                  Cant: {item.quantity}
                  {Number(item.discount_amount) > 0
                    ? ` · Desc: ${formatMoney(item.discount_amount)}`
                    : ""}
                  {item.courtesy ? " · Cortesía" : ""}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs font-semibold text-dark dark:text-white">
                  <span>Total línea: {formatMoney(Number(item.line_total))}</span>
                  <button
                    type="button"
                    onClick={() => onDeleteItem(order, item.id)}
                    disabled={deletingItemId === item.id}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red/70 text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Eliminar producto"
                  >
                    <span className="sr-only">Eliminar producto</span>
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))
          )}

          <div className="space-y-1 text-sm text-dark dark:text-white">
            <div className="flex items-center justify-between">
              <span>Subtotal</span>
              <span>{formatMoney(Number(order.subtotal))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Descuentos</span>
              <span>{formatMoney(Number(order.discount_total))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Cortesías</span>
              <span>{formatMoney(Number(order.courtesy_total))}</span>
            </div>
            <p className="text-[11px] text-dark-6 dark:text-dark-6">{PREFACTURA_INC_FOOTNOTE}</p>
            <div className="flex items-center justify-between font-semibold">
              <span>Total</span>
              <span>{formatMoney(Number(order.total))}</span>
            </div>
          </div>
          {canPayOrder ? (
            <button
              type="button"
              onClick={() => onPayOrder(order)}
              className="mt-2 w-full rounded-lg bg-red px-4 py-2 text-sm font-semibold text-white hover:bg-red/90"
            >
              Pagar
            </button>
          ) : null}
        </div>
      </div>

    </div>
  );
}

export default function PosScreen() {
  const { me } = useSession();
  const sessionWaiterId = me?.waiter_id ?? null;
  const sessionWaiterDisplay =
    (me?.waiter_name ?? "").trim() || (me?.name ?? "").trim() || null;
  /** Solo meseros con ficha vinculada omiten la selección; caja/caja_mesero y demás eligen en el modal. */
  const autoWaiterRole = me != null && (me.role ?? "").trim().toLowerCase() === "mesero";
  const useAutoWaiter = autoWaiterRole && sessionWaiterId != null;

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<PosTable[]>([]);
  const [orders, setOrders] = useState<PosOrderOut[]>([]);

  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [mode, setMode] = useState<"idle" | "view" | "create">("idle");
  const [menuTab, setMenuTab] = useState<"rest" | "bar">("rest");
  const [activeRestCategory, setActiveRestCategory] = useState<string | null>(null);
  const [activeBarCategory, setActiveBarCategory] = useState<string | null>(null);
  const [restSearch, setRestSearch] = useState("");
  const [barSearch, setBarSearch] = useState("");
  const [viewOrder, setViewOrder] = useState<PosOrderOut | null>(null);
  const [deletingViewItemId, setDeletingViewItemId] = useState<number | null>(null);
  const [viewDeleteSuccessMessage, setViewDeleteSuccessMessage] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<number, PosOrderItemCreate>>({});
  const [appendingOrderId, setAppendingOrderId] = useState<number | null>(null);
  const [noteInput, setNoteInput] = useState("");

  const [newTableName, setNewTableName] = useState("");
  const [newTableSection, setNewTableSection] = useState<TableSectionValue>("ENTRADA");
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<TableSectionFilter>("TODAS");
  const [submitStatus, setSubmitStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    const n = parseTableNumberFromName(newTableName);
    if (n != null) setNewTableSection(sectionForTableNumber(n));
  }, [newTableName]);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [paymentStep, setPaymentStep] = useState<"choice" | "new" | "existing">(
    "choice",
  );
  const [paymentOrder, setPaymentOrder] = useState<PosOrderOut | null>(null);
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearchInput, setCustomerSearchInput] = useState("");
  const [customerNameInput, setCustomerNameInput] = useState("");
  const [customerDocumentInput, setCustomerDocumentInput] = useState("");
  const [customerPhoneInput, setCustomerPhoneInput] = useState("");
  const [customerEmailInput, setCustomerEmailInput] = useState("");
  const [issueElectronicInvoice, setIssueElectronicInvoice] = useState(false);
  const [applyConsumptionTax, setApplyConsumptionTax] = useState(false);
  const [serviceTipInput, setServiceTipInput] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    if (issueElectronicInvoice) setApplyConsumptionTax(true);
  }, [issueElectronicInvoice]);

  const [waiterModalOpen, setWaiterModalOpen] = useState(false);
  const [waiterOrder, setWaiterOrder] = useState<PosOrderOut | null>(null);
  const [waiterList, setWaiterList] = useState<Waiter[]>([]);
  const [loadingWaiters, setLoadingWaiters] = useState(false);
  const [selectedWaiterId, setSelectedWaiterId] = useState("");
  const [waiterStatus, setWaiterStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const resolveWaiterName = useCallback(
    (order: PosOrderOut | null | undefined) => {
      if (!order) return null;
      const label = order.waiter_name?.trim();
      if (label) return label;
      const id = order.waiter_id;
      if (id == null) return null;
      const w = waiterList.find((x) => x.id === id);
      return w?.name?.trim() || null;
    },
    [waiterList],
  );
  const cartTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    let discount = 0;
    let courtesy = 0;
    for (const item of cartItems) {
      const qty = item.quantity;
      const price = item.unit_price;
      const lineBase = price * qty;
      const lineDiscount = Math.min(lineBase, Math.max(0, item.discount_rate ?? 0));
      const lineSubtotal = Math.max(lineBase - lineDiscount, 0);
      const lineTax = lineSubtotal * (item.tax_rate ?? 0);
      subtotal += item.courtesy ? 0 : lineSubtotal;
      tax += item.courtesy ? 0 : lineTax;
      discount += lineDiscount;
      courtesy += item.courtesy ? lineBase : 0;
    }
    return {
      subtotal,
      tax,
      discount,
      courtesy,
      total: subtotal + tax,
    };
  }, [cartItems]);

  const paymentPreview = useMemo(() => {
    if (!paymentOrder) return null;
    const subtotal = Number(paymentOrder.subtotal) || 0;
    const defaultServiceTotal = Math.max(0, Number(paymentOrder.service_total) || 0);
    const serviceTotal =
      serviceTipInput.trim() === "" ? defaultServiceTotal : parseCopAmount(serviceTipInput);
    const incTotal = applyConsumptionTax ? subtotal * INC_RATE : 0;
    const totalToCharge = subtotal + incTotal + serviceTotal;
    return {
      subtotal,
      incTotal,
      serviceTotal,
      total: totalToCharge,
    };
  }, [paymentOrder, applyConsumptionTax, serviceTipInput]);

  const activeOrders = orders;
  const visibleTables = useMemo(
    () =>
      tables.filter((table) => {
        if (selectedSectionFilter === "TODAS") return true;
        return normalizeTableSection(table.section) === selectedSectionFilter;
      }),
    [tables, selectedSectionFilter],
  );
  const activeOrderByTable = useMemo(() => {
    const map = new Map<number, PosOrderOut>();
    for (const order of orders) {
      if (["closed", "void"].includes(order.status)) continue;
      if (!map.has(order.table_id)) {
        map.set(order.table_id, order);
      }
    }
    return map;
  }, [orders]);
  const appendingBaseOrder = useMemo(() => {
    if (!appendingOrderId) return null;
    return orders.find((order) => order.id === appendingOrderId) ?? null;
  }, [orders, appendingOrderId]);
  useEffect(() => {
    if (!viewDeleteSuccessMessage) return;
    const timeoutId = window.setTimeout(() => {
      setViewDeleteSuccessMessage(null);
    }, 2200);
    return () => window.clearTimeout(timeoutId);
  }, [viewDeleteSuccessMessage]);
  useEffect(() => {
    if (
      appendingBaseOrder &&
      ["closed", "void"].includes(appendingBaseOrder.status) &&
      mode === "create"
    ) {
      setAppendingOrderId(null);
    }
  }, [appendingBaseOrder, mode]);

  function getTableName(tableId: number) {
    return tables.find((t) => t.id === tableId)?.name ?? `Mesa ${tableId}`;
  }

  function openAppendOrderFlow(order: PosOrderOut) {
    setViewOrder(null);
    setSelectedTableId(order.table_id);
    setMode("create");
    setAppendingOrderId(order.id);
    setCart({});
    setNoteInput("");
    setSubmitStatus({ kind: "idle" });
  }

  function openPayOrderFlow(order: PosOrderOut) {
    setViewOrder(null);
    if (order.status === "delivered") {
      openPaymentModal(order);
      return;
    }
    if (useAutoWaiter && sessionWaiterId != null) {
      const waiterIdForDeliver = order.waiter_id == null ? sessionWaiterId : null;
      void (async () => {
        const updated = await handleMarkOrderDelivered(order.id, waiterIdForDeliver);
        if (updated) {
          openPaymentModal(updated);
        } else {
          window.alert("No se pudo marcar el pedido como entregado. Intenta de nuevo o revisa la conexión.");
        }
      })();
      return;
    }
    openWaiterModal(order);
  }

  function handleDownloadPosTicket(order: PosOrderOut) {
    try {
      const doc = buildPosTicketPdf(order, getTableName(order.table_id));
      doc.save(`ticket-pos-${order.id}.pdf`);
    } catch (err) {
      console.error(err);
      window.alert("No se pudo generar el ticket POS.");
    }
  }

  async function handleMarkOrderDelivered(
    orderId: number,
    waiterId: number | null,
  ): Promise<PosOrderOut | null> {
    try {
      setWaiterStatus({ kind: "loading" });
      const res = await fetch(`/api/pos/orders/${orderId}/deliver`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delivered: true, waiter_id: waiterId }),
      });
      const responsePayload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setWaiterStatus({
          kind: "error",
          message:
            (typeof responsePayload?.message === "string" && responsePayload.message) ||
            (typeof responsePayload?.detail === "string" && responsePayload.detail) ||
            "No se pudo marcar el pedido como entregado.",
        });
        return null;
      }
      const updated = responsePayload as PosOrderOut;
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      setWaiterStatus({ kind: "success", message: "Pedido entregado." });
      return updated;
    } catch {
      setWaiterStatus({
        kind: "error",
        message: "Error marcando el pedido como entregado.",
      });
      return null;
    }
  }

  async function handleMarkOrderPaid(
    orderId: number,
    payload?: {
      customer_id?: number | null;
      customer_name?: string;
      customer_identity_document?: string;
      customer_phone?: string | null;
      customer_email?: string | null;
      apply_inc?: boolean;
      service_total?: number;
      utility_total?: number;
      payment_method?: string;
    },
  ): Promise<PosOrderOut | null> {
    try {
      setPaymentStatus({ kind: "loading" });
      const resolvedApplyInc = issueElectronicInvoice
        ? true
        : (payload?.apply_inc ?? applyConsumptionTax);
      const closePayload = {
        ...(payload ?? {}),
        apply_inc: resolvedApplyInc,
        payment_method: payload?.payment_method ?? paymentMethod,
        service_total:
          payload?.service_total ??
          (paymentOrder
            ? serviceTipInput.trim() === ""
              ? Math.max(0, Number(paymentOrder.service_total) || 0)
              : parseCopAmount(serviceTipInput)
            : 0),
        utility_total:
          payload?.utility_total ??
          (paymentOrder ? Math.max(0, Number(paymentOrder.utility_total) || 0) : 0),
      };
      const res = await fetch(`/api/pos/orders/${orderId}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(closePayload).filter(([, v]) => v !== ""),
          ),
        ),
      });
      const responsePayload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setPaymentStatus({
          kind: "error",
          message:
            formatApiErrorMessage(responsePayload) ||
            (typeof responsePayload?.message === "string" && responsePayload.message) ||
            (typeof responsePayload?.detail === "string" && responsePayload.detail) ||
            "No se pudo marcar el pedido como pagado.",
        });
        return null;
      }
      const updatedOrder = responsePayload as PosOrderOut;
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));
      setPaymentStatus({ kind: "success", message: "Pedido pagado." });
      return updatedOrder;
    } catch {
      setPaymentStatus({ kind: "error", message: "Error marcando el pedido como pagado." });
      return null;
    }
  }

  async function handleIssueInvoice(
    order: PosOrderOut,
    payload?: {
      customer_id?: number | null;
      customer_name?: string;
      customer_identity_document?: string;
      customer_phone?: string | null;
      customer_email?: string | null;
    },
  ) {
    if (!order.sale_id) {
      setPaymentStatus({
        kind: "error",
        message: "No se encontro la venta para emitir factura electronica.",
      });
      return false;
    }

    try {
      setPaymentStatus({ kind: "loading" });
      const res = await fetch(`/api/factus/sales/${order.sale_id}/issue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload ? JSON.stringify(payload) : null,
      });
      const responsePayload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setPaymentStatus({
          kind: "error",
          message:
            formatApiErrorMessage(responsePayload) ||
            (typeof responsePayload?.message === "string" && responsePayload.message) ||
            (typeof responsePayload?.detail === "string" && responsePayload.detail) ||
            "No se pudo emitir factura en Factus.",
        });
        return false;
      }

      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                electronic_invoice_status: "issued",
                electronic_invoice_number:
                  (responsePayload?.factus_bill_number as string | null | undefined) ?? null,
              }
            : o,
        ),
      );
      setPaymentStatus({
        kind: "success",
        message:
          (typeof responsePayload?.factus_bill_number === "string" &&
            responsePayload.factus_bill_number.trim() !== "" &&
            `Pedido pagado y factura emitida (#${responsePayload.factus_bill_number}).`) ||
          "Pedido pagado y factura emitida en Factus.",
      });
      const billNo =
        typeof responsePayload?.factus_bill_number === "string"
          ? responsePayload.factus_bill_number.trim()
          : "";
      try {
        const ticketOrder: PosOrderOut = {
          ...order,
          status: "closed",
          electronic_invoice_status: "issued",
          electronic_invoice_number: billNo || order.electronic_invoice_number || null,
        };
        const doc = buildPosTicketPdf(ticketOrder, getTableName(order.table_id));
        doc.save(`ticket-pos-${order.id}.pdf`);
      } catch (e) {
        console.error(e);
      }
      return true;
    } catch {
      setPaymentStatus({
        kind: "error",
        message: "Error conectando con Factus para emitir factura.",
      });
      return false;
    }
  }

  async function ensureFactusReady() {
    try {
      setPaymentStatus({ kind: "loading" });
      const res = await fetch("/api/factus/health", { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setPaymentStatus({
          kind: "error",
          message:
            formatApiErrorMessage(payload) ||
            (typeof payload?.message === "string" && payload.message) ||
            (typeof payload?.detail === "string" && payload.detail) ||
            "Factus no esta listo. Revisa la configuracion antes de cobrar.",
        });
        return false;
      }
      return true;
    } catch {
      setPaymentStatus({
        kind: "error",
        message: "No se pudo validar Factus antes de registrar el pago.",
      });
      return false;
    }
  }

  async function handleMarkOrderVoided(orderId: number) {
    if (!window.confirm("¿Anular este pedido?")) return;
    try {
      const res = await fetch(`/api/pos/orders/${orderId}/void`, { method: "POST" });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        window.alert(
          (typeof payload?.message === "string" && payload.message) ||
            (typeof payload?.detail === "string" && payload.detail) ||
            "No se pudo anular el pedido.",
        );
        return;
      }
      setOrders((prev) => prev.map((o) => (o.id === orderId ? (payload as PosOrderOut) : o)));
    } catch {
      window.alert("Error anulando el pedido.");
    }
  }

  async function handleDeleteOrderItem(order: PosOrderOut, itemId: number) {
    if (!window.confirm("¿Eliminar este producto del pedido?")) return;
    try {
      setDeletingViewItemId(itemId);
      setViewDeleteSuccessMessage(null);
      const res = await fetch(`/api/pos/orders/${order.id}/items/${itemId}`, { method: "DELETE" });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        window.alert(
          (typeof payload?.message === "string" && payload.message) ||
            (typeof payload?.detail === "string" && payload.detail) ||
            "No se pudo eliminar el producto del pedido.",
        );
        return;
      }

      const updatedOrder = payload as PosOrderOut;
      setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
      setViewOrder(updatedOrder);
      setViewDeleteSuccessMessage("Producto eliminado correctamente.");
    } catch {
      window.alert("Error eliminando el producto del pedido.");
    } finally {
      setDeletingViewItemId(null);
    }
  }

  async function handleDeleteTable(tableId: number) {
    if (!window.confirm("¿Eliminar esta mesa?")) return;
    try {
      const res = await fetch(`/api/pos/tables/${tableId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const payload = (await res.json().catch(() => null)) as any;
        window.alert(
          (typeof payload?.message === "string" && payload.message) ||
            (typeof payload?.detail === "string" && payload.detail) ||
            "No se pudo eliminar la mesa.",
        );
        return;
      }
      setTables((prev) => prev.filter((table) => table.id !== tableId));
      if (selectedTableId === tableId) {
        setSelectedTableId(null);
        setMode("idle");
      }
    } catch {
      window.alert("Error eliminando la mesa.");
    }
  }

  function resetWaiterForm() {
    setSelectedWaiterId("");
    setWaiterStatus({ kind: "idle" });
  }

  function openWaiterModal(order: PosOrderOut) {
    setWaiterOrder(order);
    setWaiterModalOpen(true);
    resetWaiterForm();
    if (!useAutoWaiter && order.waiter_id == null) {
      void loadWaiters();
    }
  }

  function closeWaiterModal() {
    setWaiterModalOpen(false);
    setWaiterOrder(null);
    resetWaiterForm();
  }

  async function loadWaiters() {
    setLoadingWaiters(true);
    try {
      const res = await fetch("/api/personnel/waiters?active=true", { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "No se pudo cargar meseros.",
        );
      }
      setWaiterList(Array.isArray(payload) ? (payload as Waiter[]) : []);
    } catch {
      setWaiterList([]);
    } finally {
      setLoadingWaiters(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/personnel/waiters?active=true", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        setWaiterList(data as Waiter[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleWaiterDelivery() {
    if (!waiterOrder) return;
    const hasWaiterOnOrder = waiterOrder.waiter_id != null;
    let waiterId: number | null = null;
    if (!hasWaiterOnOrder) {
      if (useAutoWaiter && sessionWaiterId != null) {
        waiterId = sessionWaiterId;
      } else {
        const parsedId = Number(selectedWaiterId);
        if (!Number.isFinite(parsedId) || parsedId <= 0) {
          setWaiterStatus({ kind: "error", message: "Selecciona un mesero." });
          return;
        }
        waiterId = parsedId;
      }
    }
    const updated = await handleMarkOrderDelivered(waiterOrder.id, waiterId);
    if (!updated) return;
    closeWaiterModal();
    openPaymentModal(updated);
  }

  function resetPaymentForm() {
    setPaymentStep("choice");
    setPaymentMethod("efectivo");
    setSelectedCustomerId("");
    setCustomerSearchInput("");
    setCustomerNameInput("");
    setCustomerDocumentInput("");
    setCustomerPhoneInput("");
    setCustomerEmailInput("");
    setIssueElectronicInvoice(false);
    setApplyConsumptionTax(false);
    setServiceTipInput("");
    setPaymentStatus({ kind: "idle" });
  }

  function openPaymentModal(order: PosOrderOut) {
    setPaymentOrder(order);
    setPaymentModalOpen(true);
    resetPaymentForm();
    setServiceTipInput(String(Math.max(0, Number(order.service_total) || 0)));
  }

  function closePaymentModal() {
    setPaymentModalOpen(false);
    setPaymentOrder(null);
    resetPaymentForm();
  }

  function printPreFactura() {
    if (!paymentOrder || !paymentPreview) {
      window.alert("No hay resumen de totales para generar la pre-factura.");
      return;
    }
    const w = window.open("", "_blank");
    if (!w) {
      window.alert("Permite ventanas emergentes para imprimir la pre-factura.");
      return;
    }
    const when = dayjs().tz(COLOMBIA_TZ).format("DD/MM/YYYY HH:mm");
    const tableName = getTableName(paymentOrder.table_id);
    const rows = paymentOrder.items
      .map(
        (it) => `<tr>
          <td style="padding:4px 8px;border:1px solid #ccc;">${escapeHtml(it.name)}</td>
          <td style="padding:4px 8px;border:1px solid #ccc;text-align:right;">${escapeHtml(String(it.quantity))}</td>
          <td style="padding:4px 8px;border:1px solid #ccc;text-align:right;">${formatMoney(preFacturaLineDisplayAmount(it))}</td>
        </tr>`,
      )
      .join("");
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pre-factura</title></head>
      <body style="font-family:system-ui,sans-serif;padding:20px;max-width:520px;">
      <h1 style="font-size:18px;margin:0 0 8px 0;">${escapeHtml(BUSINESS_NAME)}</h1>
      <p style="margin:0 0 8px 0;font-size:12px;color:#444;">Pre-factura / comprobante de consumo. No reemplaza la factura electrónica; si aplica, se emite vía Factus al guardar pago con facturación activada.</p>
      <p style="font-size:13px;margin:0 0 4px 0;"><strong>Pedido</strong> #${paymentOrder.id} &nbsp;|&nbsp; <strong>Mesa</strong> ${escapeHtml(tableName)} &nbsp;|&nbsp; ${when}</p>
      <p style="font-size:13px;margin:0 0 8px 0;"><strong>Medio de pago (preferencia)</strong>: ${escapeHtml(paymentMethodLabel(paymentMethod))}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:4px;">
        <thead><tr><th style="text-align:left;border:1px solid #ccc;padding:4px 8px;">Item</th>
        <th style="border:1px solid #ccc;padding:4px 8px;">Cant.</th>
        <th style="border:1px solid #ccc;padding:4px 8px;">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:12px;font-size:13px;">
        <p style="margin:8px 0 0 0;"><strong>Total: ${formatMoney(paymentPreview.total)}</strong></p>
        <p style="margin:8px 0 0 0;font-size:11px;color:#555;">${escapeHtml(PREFACTURA_INC_FOOTNOTE)}</p>
      </div>
      </body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  function downloadPreFacturaPdf() {
    if (!paymentOrder || !paymentPreview) {
      window.alert("No hay resumen de totales para generar la pre-factura.");
      return;
    }
    try {
      const doc = buildPreFacturaPdf(
        paymentOrder,
        paymentPreview,
        getTableName(paymentOrder.table_id),
        paymentMethod,
      );
      doc.save(`pre-factura-pedido-${paymentOrder.id}.pdf`);
    } catch (err) {
      console.error(err);
      window.alert("No se pudo generar el PDF. Proba de nuevo.");
    }
  }

  async function loadCustomers() {
    setLoadingCustomers(true);
    try {
      const res = await fetch("/api/personnel/customers?active=true", { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "No se pudo cargar clientes.",
        );
      }
      setCustomerList(Array.isArray(payload) ? (payload as Customer[]) : []);
    } catch {
      setCustomerList([]);
    } finally {
      setLoadingCustomers(false);
    }
  }

  async function handleOccasionalPayment() {
    if (!paymentOrder) return;
    if (issueElectronicInvoice) {
      setPaymentStatus({
        kind: "error",
        message: "Para facturar en Factus debes registrar o seleccionar un cliente.",
      });
      return;
    }
    const closedOrder = await handleMarkOrderPaid(paymentOrder.id, {
      apply_inc: applyConsumptionTax,
    });
    if (closedOrder) closePaymentModal();
  }

  async function handleExistingCustomerPayment() {
    if (!paymentOrder) return;
    const parsedId = Number(selectedCustomerId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      setPaymentStatus({ kind: "error", message: "Selecciona un cliente." });
      return;
    }
    if (issueElectronicInvoice) {
      const factusReady = await ensureFactusReady();
      if (!factusReady) return;
    }
    const closePayload = { customer_id: parsedId, apply_inc: applyConsumptionTax };
    const closedOrder = await handleMarkOrderPaid(paymentOrder.id, closePayload);
    if (!closedOrder) return;

    if (!issueElectronicInvoice) {
      closePaymentModal();
      return;
    }

    const invoicePayload = {
      customer_id: parsedId,
      customer_email: customerEmailInput.trim() || null,
    };
    const ok = await handleIssueInvoice(closedOrder, invoicePayload);
    if (ok) closePaymentModal();
  }

  async function handleNewCustomerPayment() {
    if (!paymentOrder) return;
    const name = customerNameInput.trim();
    const document = customerDocumentInput.trim();
    if (!name || !document) {
      setPaymentStatus({ kind: "error", message: "Nombre y documento son requeridos." });
      return;
    }
    if (issueElectronicInvoice) {
      const factusReady = await ensureFactusReady();
      if (!factusReady) return;
    }
    const phone = customerPhoneInput.trim();
    const closePayload = {
      customer_name: name,
      customer_identity_document: document,
      customer_phone: phone ? phone : null,
      customer_email: customerEmailInput.trim() || null,
      apply_inc: applyConsumptionTax,
    };
    const closedOrder = await handleMarkOrderPaid(paymentOrder.id, closePayload);
    if (!closedOrder) return;

    if (!issueElectronicInvoice) {
      closePaymentModal();
      return;
    }

    const ok = await handleIssueInvoice(closedOrder, {
      customer_name: name,
      customer_identity_document: document,
      customer_phone: phone ? phone : null,
      customer_email: customerEmailInput.trim() || null,
    });
    if (ok) closePaymentModal();
  }

  const filteredCustomerList = useMemo(() => {
    const rawQuery = normalizeSearchText(customerSearchInput);
    if (!rawQuery) return customerList;
    const compactQuery = rawQuery.replace(/[^a-z0-9]/g, "");

    return customerList.filter((customer) => {
      const name = normalizeSearchText(customer.name ?? "");
      const document = normalizeSearchText(customer.identity_document ?? "");
      const compactDocument = document.replace(/[^a-z0-9]/g, "");
      return (
        name.includes(rawQuery) ||
        document.includes(rawQuery) ||
        (compactQuery !== "" && compactDocument.includes(compactQuery))
      );
    });
  }, [customerList, customerSearchInput]);

  useEffect(() => {
    if (paymentStep !== "existing") return;

    if (filteredCustomerList.length === 0) {
      if (selectedCustomerId !== "") setSelectedCustomerId("");
      return;
    }

    const selectedStillVisible = filteredCustomerList.some(
      (customer) => String(customer.id) === selectedCustomerId,
    );
    if (selectedStillVisible) return;

    if (filteredCustomerList.length === 1) {
      setSelectedCustomerId(String(filteredCustomerList[0].id));
      return;
    }

    setSelectedCustomerId("");
  }, [paymentStep, filteredCustomerList, selectedCustomerId]);

  const groupedBar = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of menuItems) {
      if (!isPosOrderableMenuItem(item)) continue;
      const key = categoryKey(item.category);
      if (!BAR_CATEGORY_KEYS.has(key)) continue;
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return [...groups.entries()];
  }, [menuItems]);

  const groupedRest = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of menuItems) {
      if (!isPosOrderableMenuItem(item)) continue;
      const key = categoryKey(item.category);
      if (BAR_CATEGORY_KEYS.has(key)) continue;
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return [...groups.entries()];
  }, [menuItems]);

  const restItemCount = useMemo(
    () => groupedRest.reduce((acc, [, items]) => acc + items.length, 0),
    [groupedRest],
  );
  const barItemCount = useMemo(
    () => groupedBar.reduce((acc, [, items]) => acc + items.length, 0),
    [groupedBar],
  );

  useEffect(() => {
    if (!activeRestCategory && groupedRest.length > 0) {
      setActiveRestCategory(groupedRest[0][0]);
    }
    // Reset búsqueda al cambiar de categoría activa
    setRestSearch("");
  }, [groupedRest, activeRestCategory]);

  useEffect(() => {
    if (!activeBarCategory && groupedBar.length > 0) {
      setActiveBarCategory(groupedBar[0][0]);
    }
    // Reset búsqueda al cambiar de categoría activa
    setBarSearch("");
  }, [groupedBar, activeBarCategory]);

  useEffect(() => {
    fetch("/api/menu/items")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setMenuItems(data));
    fetch("/api/pos/tables")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setTables(data));
    fetch("/api/pos/orders")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setOrders(data));
  }, []);

  function addToCart(item: MenuItem) {
    if (mode !== "create") return;
    if (!isPosOrderableMenuItem(item)) return;
    setCart((prev) => {
      const existing = prev[item.id];
      const nextQty = existing ? existing.quantity + 1 : 1;
      const gross = menuItemSellPriceCop(item.price);
      const unitPrice = posOrderNetUnitFromMenuGrossCop(gross);
      return {
        ...prev,
        [item.id]: {
          menu_item_id: item.id,
          quantity: nextQty,
          unit_price: unitPrice,
          tax_rate: 0,
          discount_rate: null,
          courtesy: false,
          note: existing?.note ?? null,
        },
      };
    });
  }

  function updateCart(
    id: number,
    updater: (item: PosOrderItemCreate) => PosOrderItemCreate | null,
  ) {
    setCart((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const next = updater(current);
      if (!next) {
        const clone = { ...prev };
        delete clone[id];
        return clone;
      }
      return { ...prev, [id]: next };
    });
  }

  async function handleCreateTable() {
    const name = newTableName.trim();
    if (!name) return;
    setSubmitStatus({ kind: "loading" });
    try {
      const res = await fetch("/api/pos/tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, section: newTableSection }),
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setSubmitStatus({
          kind: "error",
          message:
            (typeof payload?.message === "string" && payload.message) ||
            "No se pudo crear la mesa.",
        });
        return;
      }
      setTables((prev) => [...prev, payload as PosTable]);
      setNewTableName("");
      setSelectedSectionFilter(newTableSection);
      setSubmitStatus({ kind: "success", message: "Mesa creada." });
    } catch {
      setSubmitStatus({ kind: "error", message: "Error creando la mesa." });
    }
  }

  async function handleCreateOrder() {
    if (!selectedTableId) {
      window.alert("Selecciona una mesa");
      return;
    }
    if (cartItems.length === 0) {
      window.alert("Agrega items al pedido");
      return;
    }

    const isAppending = Boolean(appendingOrderId);

    setSubmitStatus({ kind: "loading" });
    try {
      const payloadBody = {
        items: cartItems.map((ci) => {
          const lineBase = ci.unit_price * ci.quantity;
          const discount_amount = Math.min(lineBase, Math.max(0, ci.discount_rate ?? 0));
          return {
            menu_item_id: ci.menu_item_id,
            quantity: ci.quantity,
            unit_price: ci.unit_price,
            tax_rate: ci.tax_rate ?? 0,
            discount_amount,
            courtesy: ci.courtesy,
            note: ci.note ?? null,
          };
        }),
      };
      const res = await fetch(
        isAppending ? `/api/pos/orders/${appendingOrderId}/items` : "/api/pos/orders",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            isAppending
              ? payloadBody
              : {
                  table_id: selectedTableId,
                  service_total: 0,
                  waiter_id: useAutoWaiter ? sessionWaiterId : null,
                  ...payloadBody,
                },
          ),
        },
      );
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setSubmitStatus({
          kind: "error",
          message:
            (typeof payload?.message === "string" && payload.message) ||
            (isAppending
              ? "No se pudieron agregar items a la comanda."
              : "No se pudo crear la orden."),
        });
        return;
      }
      const updatedOrder = payload as PosOrderOut;
      setOrders((prev) => {
        const existingIdx = prev.findIndex((o) => o.id === updatedOrder.id);
        if (existingIdx === -1) return [updatedOrder, ...prev];
        const clone = [...prev];
        clone[existingIdx] = updatedOrder;
        return clone;
      });
      setCart({});
      setNoteInput("");
      if (isAppending) {
        setAppendingOrderId(null);
        setMode("idle");
        setSelectedTableId(null);
        setSubmitStatus({ kind: "idle" });
        setViewOrder(updatedOrder);
      } else {
        setAppendingOrderId(null);
        setMode("idle");
        setSelectedTableId(null);
        setSubmitStatus({ kind: "idle" });
        openPayOrderFlow(updatedOrder);
      }
    } catch {
      setSubmitStatus({
        kind: "error",
        message: appendingOrderId
          ? "Error agregando items a la comanda."
          : "Error creando la orden.",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-dark dark:text-white">Mesas</h2>
            <p className="text-sm text-body-color dark:text-dark-6">
              Crea mesas y asigna el pedido.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <input
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              placeholder="Mesa 1"
              className="rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
            />
            <select
              value={newTableSection}
              onChange={(e) => setNewTableSection(e.target.value as TableSectionValue)}
              className="rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
            >
              {TABLE_SECTION_VALUES.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreateTable}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"
            >
              Crear mesa
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(["TODAS", ...TABLE_SECTION_VALUES] as const).map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setSelectedSectionFilter(section)}
              className={
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition " +
                (selectedSectionFilter === section
                  ? "border-primary bg-primary text-white"
                  : "border-stroke bg-white text-dark hover:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white")
              }
            >
              {section}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visibleTables.map((table) => (
            (() => {
              const latestOrder = activeOrderByTable.get(table.id);
              const tableSection = normalizeTableSection(table.section);
              return (
            <div
              key={table.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSelectedTableId(table.id);
                setMode("view");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedTableId(table.id);
                  setMode("view");
                }
              }}
              className={
                "relative aspect-square overflow-hidden rounded-2xl border border-stroke shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-dark-3 " +
                (selectedTableId === table.id ? "ring-2 ring-primary" : "hover:opacity-90")
              }
              style={{ backgroundImage: "url('/images/cards/mesa.jpg')", backgroundSize: "cover" }}
            >
              <div className="absolute inset-0 bg-black/35" />
              <div className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-dark shadow-sm">
                {tableSection}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteTable(table.id);
                }}
                className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-red shadow-sm hover:bg-white"
              >
                <span className="sr-only">Eliminar mesa</span>
                <TrashIcon />
              </button>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-3 pb-2 pt-10 text-white">
                <div className="mb-2 flex justify-center gap-2">
                  {latestOrder ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewOrder(latestOrder);
                      }}
                      className="rounded-lg bg-white/85 px-2 py-1 text-xs font-semibold text-dark hover:bg-white"
                    >
                      Ver pedido
                    </button>
                  ) : null}
                  {!latestOrder ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTableId(table.id);
                        setMode("create");
                        setAppendingOrderId(null);
                        setCart({});
                      }}
                      className="rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-white hover:bg-primary/90"
                    >
                      Realizar pedido
                    </button>
                  ) : null}
                </div>
                {latestOrder && resolveWaiterName(latestOrder) ? (
                  <div className="mb-1 text-center text-[10px] font-medium leading-tight text-white/95">
                    Mesero: {resolveWaiterName(latestOrder)}
                  </div>
                ) : null}
                <div className="text-center text-sm font-semibold">{table.name}</div>
              </div>
              </div>
              );
            })()
          ))}
      </div>
    </div>

      <div className="rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div>
            <h2 className="text-lg font-semibold text-dark dark:text-white">Pedidos</h2>
            <p className="text-sm text-body-color dark:text-dark-6">
              Comandas en curso, entregadas o pagadas. Los pedidos facturados ante la DIAN se muestran en
              verde.
            </p>
          </div>
        </div>

        {activeOrders.length === 0 ? (
          <p className="text-sm text-dark-6 dark:text-dark-6">No hay pedidos activos.</p>
        ) : (
          <TableScroll className="-mx-1 sm:mx-0">
          <Table>
            <TableHeader>
              <TableRow className="border-none bg-[#F7F9FC] dark:bg-dark-2 [&>th]:py-4 [&>th]:text-base [&>th]:text-dark [&>th]:dark:text-white">
                <TableHead className="min-w-[180px] xl:pl-7.5">Nombre del pedido</TableHead>
                <TableHead className="min-w-[160px]">Creado</TableHead>
                <TableHead className="min-w-[160px]">Entregado</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right xl:pr-7.5">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeOrders.map((order) => {
                const status = posOrderRowStatusMeta(order);
                const createdAt = toColombiaTime(order.opened_at);
                const deliveredAt = toColombiaTime(order.delivered_at);
                const isDelivered = order.status === "delivered";
                const isPaid = order.status === "closed";
                const isVoided = order.status === "void";
                const canVoid = order.status === "open" || order.status === "sent";
                const invoicedOk =
                  isPaid && order.electronic_invoice_status === "issued";
                const actionTooltip = isPaid
                  ? invoicedOk
                    ? "Pedido finalizado"
                    : "Pedido pagado"
                  : isDelivered
                    ? "Marcar pago"
                    : "Marcar entrega";
                const rowHighlight = invoicedOk
                  ? "bg-green-50/95 dark:bg-green-950/35 border-l-4 border-l-green-600"
                  : "";
                return (
                  <TableRow
                    key={order.id}
                    className={`border-[#eee] dark:border-dark-3 ${rowHighlight}`}
                  >
                    <TableCell className="min-w-[200px] xl:pl-7.5">
                      <h5 className="text-dark dark:text-white">Pedido #{order.id}</h5>
                      {resolveWaiterName(order) ? (
                        <p className="mt-[2px] text-body-sm font-medium text-dark-6 dark:text-dark-6">
                          Mesero: {resolveWaiterName(order)}
                        </p>
                      ) : null}
                      <p className="mt-[3px] text-body-sm font-medium text-dark-6 dark:text-dark-6">
                        Mesa: {getTableName(order.table_id)} · Total: {formatMoney(order.total)}
                      </p>
                      {order.status === "closed" ? (
                        <p
                          className={
                            invoicedOk
                              ? "mt-[2px] text-xs font-semibold text-green-700 dark:text-green-300"
                              : "mt-[2px] text-xs text-body-color dark:text-dark-6"
                          }
                        >
                          Factura electrónica:{" "}
                          {order.electronic_invoice_status === "issued"
                            ? `Emitida${order.electronic_invoice_number ? ` (#${order.electronic_invoice_number})` : ""}`
                            : order.electronic_invoice_status === "failed"
                              ? "Fallida"
                              : "Pendiente"}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="min-w-[170px]">
                      <p className="text-dark dark:text-white">
                        {createdAt?.isValid()
                          ? createdAt.format("DD/MM/YYYY HH:mm")
                          : "Fecha no disponible"}
                      </p>
                    </TableCell>
                    <TableCell className="min-w-[170px]">
                      <p className="text-dark dark:text-white">
                        {deliveredAt?.isValid() ? deliveredAt.format("DD/MM/YYYY HH:mm") : "—"}
                      </p>
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      <div className={`max-w-fit rounded-full px-3.5 py-1 text-sm font-medium ${status.className}`}>
                        {status.label}
                      </div>
                    </TableCell>
                    <TableCell className="xl:pr-7.5">
                      <div className="flex items-center justify-end gap-x-3.5">
                        <Tooltip label={actionTooltip}>
                          <button
                            type="button"
                            onClick={() => {
                              if (isVoided) return;
                              if (isPaid) return;
                              openPayOrderFlow(order);
                            }}
                            disabled={isVoided || isPaid}
                            className={
                              "flex h-9 w-9 items-center justify-center rounded-lg border text-primary " +
                              (isVoided || isPaid
                                ? invoicedOk
                                  ? "cursor-default border-green-500/50 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200"
                                  : "cursor-not-allowed border-gray-300 text-gray-400"
                                : "border-primary/70 hover:border-primary hover:bg-primary/10")
                            }
                          >
                            <span className="sr-only">{actionTooltip}</span>
                            {isPaid ? <CheckIcon /> : isDelivered ? (
                              <HiOutlineCash />
                            ) : (
                              <CheckIcon />
                            )}
                          </button>
                        </Tooltip>
                        {canVoid ? (
                        <Tooltip label="Anular pedido">
                            <button
                              type="button"
                              onClick={() => handleMarkOrderVoided(order.id)}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-red/70 text-red hover:border-red hover:bg-red/10"
                            >
                              <span className="sr-only">Anular pedido</span>
                              <RiProhibited2Line />
                            </button>
                          </Tooltip>
                        ) : null}
                        <Tooltip label="Descargar ticket POS (PDF)">
                          <button
                            type="button"
                            onClick={() => handleDownloadPosTicket(order)}
                            className="hover:text-primary"
                          >
                            <span className="sr-only">Descargar ticket POS</span>
                            <DownloadIcon />
                          </button>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </TableScroll>
        )}
      </div>

      {waiterModalOpen && waiterOrder ? (
        <div
          className="fixed inset-0 z-99 flex items-center justify-center bg-black/60 p-4 opacity-0 animate-[fadeIn_160ms_ease-out_forwards]"
          role="dialog"
          aria-modal="true"
          onClick={closeWaiterModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-stroke bg-white p-5 shadow-2xl opacity-0 animate-[fadeIn_200ms_ease-out_60ms_forwards] dark:border-dark-3 dark:bg-gray-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-dark dark:text-white">
                  {waiterOrder.waiter_id != null
                    ? "Marcar entrega"
                    : useAutoWaiter
                      ? "Confirmar entrega"
                      : "Asignar mesero"}
                </h3>
                <p className="text-sm text-body-color dark:text-dark-6">
                  Pedido #{waiterOrder.id} · Mesa {getTableName(waiterOrder.table_id)}
                  {resolveWaiterName(waiterOrder) ? ` · ${resolveWaiterName(waiterOrder)}` : ""}
                </p>
                <p className="mt-2 text-xs text-body-color dark:text-dark-6">
                  Al continuar se marca la entrega y se abre el cobro y facturación.
                </p>
              </div>
              <button
                type="button"
                onClick={closeWaiterModal}
                className="rounded-lg border border-stroke px-3 py-1.5 text-sm font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {waiterOrder.waiter_id == null && !useAutoWaiter ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                    Selecciona mesero
                  </label>
                  <select
                    value={selectedWaiterId}
                    onChange={(e) => setSelectedWaiterId(e.target.value)}
                    className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                    disabled={loadingWaiters}
                  >
                    <option value="">Seleccionar mesero</option>
                    {waiterList.map((waiter) => (
                      <option key={waiter.id} value={String(waiter.id)}>
                        {waiter.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {waiterOrder.waiter_id == null && useAutoWaiter && sessionWaiterDisplay ? (
                <p className="rounded-md border border-stroke bg-gray-2 px-3 py-2 text-sm text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white">
                  Mesero: <span className="font-semibold">{sessionWaiterDisplay}</span>
                  {me?.email ? (
                    <span className="mt-1 block text-[11px] font-normal text-body-color dark:text-dark-6">
                      Sesión: {me.email}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  onClick={closeWaiterModal}
                  className="rounded-lg border border-stroke px-4 py-2 text-sm font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleWaiterDelivery}
                  disabled={waiterStatus.kind === "loading"}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {waiterStatus.kind === "loading" ? "Guardando..." : "Continuar al pago"}
                </button>
              </div>
            </div>

            {waiterStatus.kind === "error" ? (
              <div className="mt-3 rounded-md border border-red-light bg-red-light-5 px-3 py-2 text-sm text-red dark:border-red-light/40 dark:bg-red-light-5/10 dark:text-red-light">
                {waiterStatus.message}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {paymentModalOpen && paymentOrder ? (
        <div
          className="fixed inset-0 z-99 flex items-center justify-center bg-black/60 p-4 opacity-0 animate-[fadeIn_160ms_ease-out_forwards]"
          role="dialog"
          aria-modal="true"
          onClick={closePaymentModal}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-stroke bg-white p-5 shadow-2xl opacity-0 animate-[fadeIn_200ms_ease-out_60ms_forwards] dark:border-dark-3 dark:bg-gray-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-dark dark:text-white">
                  Registrar pago
                </h3>
                <p className="text-sm text-body-color dark:text-dark-6">
                  Pedido #{paymentOrder.id} · Mesa {getTableName(paymentOrder.table_id)}
                </p>
              </div>
              <button
                type="button"
                onClick={closePaymentModal}
                className="rounded-lg border border-stroke px-3 py-1.5 text-sm font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-dark dark:text-white">
                <input
                  type="checkbox"
                  checked={issueElectronicInvoice}
                  onChange={(e) => setIssueElectronicInvoice(e.target.checked)}
                  className="h-4 w-4"
                />
                Emitir
              </label>
              <p className="mt-1 text-xs text-body-color dark:text-dark-6">
                Requiere cliente con documento. Si falla Factus, el pedido queda pagado y puedes
                reintentar.
              </p>
              {issueElectronicInvoice ? (
                <div className="mt-3">
                  {paymentStep !== "new" ? (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                        Email cliente (opcional)
                      </label>
                      <input
                        value={customerEmailInput}
                        onChange={(e) => setCustomerEmailInput(e.target.value)}
                        className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                        placeholder="cliente@correo.com"
                      />
                    </div>
                  ) : null}
                  <p className="mt-2 text-[11px] text-body-color dark:text-dark-6">
                    Rango de numeracion tomado desde configuracion del sistema.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-lg border border-stroke bg-gray-1 p-3 dark:border-dark-3 dark:bg-white/5">
              <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                Propina (COP)
              </label>
              <input
                value={serviceTipInput}
                onChange={(e) => setServiceTipInput(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                placeholder="Ej: 5000"
              />
            </div>

            <div className="mt-4 rounded-lg border border-stroke bg-gray-1 p-3 dark:border-dark-3 dark:bg-white/5">
              <div>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-dark dark:text-white">
                  <input
                    type="checkbox"
                    checked={applyConsumptionTax}
                    onChange={(e) => setApplyConsumptionTax(e.target.checked)}
                    disabled={issueElectronicInvoice}
                    className="h-4 w-4 disabled:opacity-60"
                  />
                  Aplicar impuesto al consumo (INC 8%)
                </label>
                <p className="mt-1 text-xs text-body-color dark:text-dark-6">
                  {issueElectronicInvoice
                    ? "Al emitir factura electrónica el INC se aplica automáticamente."
                    : "Si no lo marcas, el pedido se cierra sin INC."}
                </p>
              </div>

              {paymentPreview ? (
                <div className="mt-3 space-y-1 rounded-md border border-stroke bg-white p-3 text-xs text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white">
                  <div className="flex items-center justify-between text-base font-semibold">
                    <span>Total</span>
                    <span>{formatMoney(paymentPreview.total)}</span>
                  </div>
                  <p className="pt-1 text-[10px] leading-snug text-body-color dark:text-dark-6">
                    {PREFACTURA_INC_FOOTNOTE}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-lg border border-stroke bg-gray-1 p-3 dark:border-dark-3 dark:bg-white/5">
              <label className="mb-1 block text-sm font-semibold text-dark dark:text-white">
                Medio de pago (preferencia del cliente)
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
              >
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {paymentPreview && paymentOrder ? (
              <div className="mt-4 rounded-lg border border-dashed border-secondary/50 bg-white p-3 dark:border-secondary/30 dark:bg-dark-2">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-dark dark:text-white">Pre-factura (cliente)</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={downloadPreFacturaPdf}
                      className="rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary/90"
                    >
                      Descargar PDF
                    </button>
                    <button
                      type="button"
                      onClick={printPreFactura}
                      className="rounded-md border border-secondary/60 bg-white px-3 py-1.5 text-xs font-semibold text-secondary hover:bg-secondary/10"
                    >
                      Imprimir
                    </button>
                  </div>
                </div>
                <p className="mb-2 text-[11px] text-body-color dark:text-dark-6">
                  Documento informativo para el cliente. La factura electrónica (si la activaste arriba) la
                  emite Factus; esta hoja no tiene CUFE.
                </p>
                <p className="mb-2 text-xs text-dark dark:text-white">
                  Medio: <span className="font-semibold">{paymentMethodLabel(paymentMethod)}</span>
                </p>
                <div className="max-h-40 overflow-y-auto rounded border border-stroke dark:border-dark-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Cant.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentOrder.items.map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-sm">{it.name}</TableCell>
                          <TableCell className="text-right text-sm">{it.quantity}</TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatMoney(preFacturaLineDisplayAmount(it))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-dark dark:text-white">
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span>{formatMoney(paymentPreview.total)}</span>
                  </div>
                  <p className="pt-1 text-[10px] leading-snug text-body-color dark:text-dark-6">
                    {PREFACTURA_INC_FOOTNOTE}
                  </p>
                </div>
              </div>
            ) : null}

            {paymentStep === "choice" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={handleOccasionalPayment}
                  className="rounded-lg border border-stroke px-3 py-3 text-sm font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                >
                  Cliente ocasional
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentStep("new");
                    setPaymentStatus({ kind: "idle" });
                  }}
                  className="rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-white hover:bg-primary/90"
                >
                  Cliente nuevo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentStep("existing");
                    setPaymentStatus({ kind: "idle" });
                    setCustomerSearchInput("");
                    loadCustomers();
                  }}
                  className="rounded-lg border border-primary/40 px-3 py-3 text-sm font-semibold text-primary hover:border-primary hover:bg-primary/10"
                >
                  Cliente existente
                </button>
              </div>
            ) : null}

            {paymentStep === "new" ? (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                      Nombre / Razon social
                    </label>
                    <input
                      value={customerNameInput}
                      onChange={(e) => setCustomerNameInput(e.target.value)}
                      className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      placeholder="Nombre completo o razon social"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                      N° de identificacion / NIT
                    </label>
                    <input
                      value={customerDocumentInput}
                      onChange={(e) => setCustomerDocumentInput(e.target.value)}
                      className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      placeholder="CC, NIT, etc."
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                      N° de telefono
                    </label>
                    <input
                      value={customerPhoneInput}
                      onChange={(e) => setCustomerPhoneInput(e.target.value)}
                      className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      placeholder="Telefono"
                      inputMode="tel"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                      Correo electronico
                    </label>
                    <input
                      type="email"
                      value={customerEmailInput}
                      onChange={(e) => setCustomerEmailInput(e.target.value)}
                      className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      placeholder="cliente@correo.com"
                      autoComplete="email"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentStep("choice");
                      setPaymentStatus({ kind: "idle" });
                    }}
                    className="rounded-lg border border-stroke px-4 py-2 text-sm font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={handleNewCustomerPayment}
                    disabled={paymentStatus.kind === "loading"}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    {paymentStatus.kind === "loading" ? "Guardando..." : "Guardar pago"}
                  </button>
                </div>
              </div>
            ) : null}

            {paymentStep === "existing" ? (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                      Buscar cliente
                    </label>
                    <input
                      value={customerSearchInput}
                      onChange={(e) => setCustomerSearchInput(e.target.value)}
                      className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      placeholder="Buscar por nombre o cédula"
                      disabled={loadingCustomers}
                    />
                    <p className="mt-1 text-[11px] text-body-color dark:text-dark-6">
                      {loadingCustomers
                        ? "Cargando clientes..."
                        : `${filteredCustomerList.length} cliente(s) encontrado(s)`}
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                      Selecciona cliente
                    </label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      disabled={loadingCustomers}
                    >
                      <option value="">Seleccionar cliente</option>
                      {filteredCustomerList.map((customer) => (
                        <option key={customer.id} value={String(customer.id)}>
                          {customer.name} · {customer.identity_document}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentStep("choice");
                      setPaymentStatus({ kind: "idle" });
                    }}
                    className="rounded-lg border border-stroke px-4 py-2 text-sm font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={handleExistingCustomerPayment}
                    disabled={paymentStatus.kind === "loading"}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    {paymentStatus.kind === "loading" ? "Guardando..." : "Guardar pago"}
                  </button>
                </div>
              </div>
            ) : null}

            {paymentStatus.kind === "success" ? (
              <div className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100">
                {paymentStatus.message}
              </div>
            ) : null}

            {paymentStatus.kind === "error" ? (
              <div className="mt-3 rounded-md border border-red-light bg-red-light-5 px-3 py-2 text-sm text-red dark:border-red-light/40 dark:bg-red-light-5/10 dark:text-red-light">
                {paymentStatus.message}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === "create" && selectedTableId && (
        <div
          className="fixed inset-0 z-99 flex items-center justify-center bg-black/60 p-4 opacity-0 animate-[fadeIn_160ms_ease-out_forwards]"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setMode("idle");
            setSelectedTableId(null);
            setAppendingOrderId(null);
            setCart({});
            setNoteInput("");
          }}
        >
          <div
            className="grid h-[90vh] w-full max-w-[96vw] grid-cols-1 gap-4 overflow-hidden rounded-2xl border border-stroke bg-white p-4 shadow-2xl opacity-0 animate-[fadeIn_200ms_ease-out_60ms_forwards] dark:border-dark-3 dark:bg-gray-dark md:grid-cols-[2.2fr_1.3fr] xl:max-w-[1500px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-y-auto pr-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-dark dark:text-white">
                    {appendingBaseOrder ? "Añadir pedido" : "Realizar pedido"} -{" "}
                    {tables.find((t) => t.id === selectedTableId)?.name}
                  </h3>
                  <p className="text-xs text-body-color dark:text-dark-6">
                    {appendingBaseOrder
                      ? `Comanda #${appendingBaseOrder.id}: agrega nuevos items (Restaurante / Bar)`
                      : "Selecciona productos (Restaurante / Bar)"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMode("idle");
                    setSelectedTableId(null);
                    setAppendingOrderId(null);
                    setCart({});
                    setNoteInput("");
                  }}
                  className="rounded-lg border border-stroke px-3 py-1.5 text-sm font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                >
                  Cerrar
                </button>
              </div>

              {appendingBaseOrder && resolveWaiterName(appendingBaseOrder) ? (
                <p className="mt-3 text-sm text-dark dark:text-white">
                  <span className="text-body-color dark:text-dark-6">Mesero de la comanda: </span>
                  <span className="font-semibold">{resolveWaiterName(appendingBaseOrder)}</span>
                </p>
              ) : null}

              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMenuTab("rest")}
                    className={
                      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold " +
                      (menuTab === "rest"
                        ? "bg-primary text-white"
                        : "bg-gray-1 text-dark hover:bg-gray-2 dark:bg-dark-2 dark:text-white")
                    }
                  >
                    <RiRestaurantLine className="h-4 w-4 shrink-0" aria-hidden />
                    Restaurante ({restItemCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuTab("bar")}
                    className={
                      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold " +
                      (menuTab === "bar"
                        ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                        : "bg-gray-1 text-dark hover:bg-gray-2 dark:bg-dark-2 dark:text-white")
                    }
                  >
                    <RiDrinks2Fill className="h-4 w-4 shrink-0" aria-hidden />
                    Bar ({barItemCount})
                  </button>
                </div>

                {menuTab === "rest" ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex flex-wrap gap-2">
                        {groupedRest.map(([cat]) => {
                          const CatIcon = getPosCategoryIcon(cat, "rest");
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setActiveRestCategory(cat)}
                              className={
                                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold " +
                                (activeRestCategory === cat
                                  ? "bg-primary text-white"
                                  : "bg-primary/10 text-primary hover:bg-primary/20")
                              }
                            >
                              <CatIcon className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              {cat}
                            </button>
                          );
                        })}
                      </div>
                      <div className="relative ml-auto w-full max-w-xs">
                        <input
                          value={restSearch}
                          onChange={(e) => setRestSearch(e.target.value)}
                          placeholder="Buscar en restaurante..."
                          className="w-full rounded-lg border-2 border-primary/40 bg-white py-2 pl-11 pr-3 text-sm text-dark shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                        />
                        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
                      </div>
                    </div>
                    <div className="space-y-3">
                      {groupedRest
                        .filter(([cat]) => !activeRestCategory || cat === activeRestCategory)
                        .map(([cat, items]) => (
                          <div key={cat} className="space-y-2">
                            <div className="text-xs font-semibold uppercase text-dark-6 dark:text-dark-6">
                              {cat}
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              {items
                                .filter((item) => {
                                  const term = normalizeSearchText(restSearch);
                                  if (!term) return true;
                                  return (
                                    normalizeSearchText(item.name).includes(term) ||
                                    normalizeSearchText(item.description ?? "").includes(term)
                                  );
                                })
                                .map((item) => (
                                  <div
                                    key={item.id}
                                    className="flex h-full flex-col rounded-xl border border-stroke bg-white p-3 shadow-sm dark:border-dark-3 dark:bg-dark-2"
                                  >
                                    <div className="flex-1">
                                      <div className="flex items-start justify-between gap-2">
                                        <div>
                                          <div className="text-sm font-semibold text-dark dark:text-white">
                                            {item.name}
                                          </div>
                                          <div className="text-xs text-dark-6 dark:text-dark-6">
                                            {item.category}
                                          </div>
                                        </div>
                                        <div className="text-sm font-semibold text-primary">
                                          {formatMoney(item.price)}
                                        </div>
                                      </div>
                                      {item.description ? (
                                        <p className="mt-1 text-xs text-dark-6 dark:text-dark-6">
                                          {item.description}
                                        </p>
                                      ) : null}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => addToCart(item)}
                                      className="mt-2 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"
                                    >
                                      Agregar
                                    </button>
                                  </div>
                                ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex flex-wrap gap-2">
                        {groupedBar.map(([cat]) => {
                          const CatIcon = getPosCategoryIcon(cat, "bar");
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setActiveBarCategory(cat)}
                              className={
                                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold " +
                                (activeBarCategory === cat
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                                  : "bg-emerald-100 text-emerald-900 hover:bg-emerald-200/90 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-900/35")
                              }
                            >
                              <CatIcon className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                              {cat}
                            </button>
                          );
                        })}
                      </div>
                      <div className="relative ml-auto w-full max-w-xs">
                        <input
                          value={barSearch}
                          onChange={(e) => setBarSearch(e.target.value)}
                          placeholder="Buscar en bar..."
                          className="w-full rounded-lg border-2 border-emerald-500/35 bg-white py-2 pl-11 pr-3 text-sm text-dark shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                        />
                        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-600 dark:text-emerald-400" />
                      </div>
                    </div>
                    <div className="space-y-3">
                      {groupedBar
                        .filter(([cat]) => !activeBarCategory || cat === activeBarCategory)
                        .map(([cat, items]) => (
                          <div key={cat} className="space-y-2">
                            <div className="text-xs font-semibold uppercase text-dark-6 dark:text-dark-6">
                              {cat}
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              {items
                                .filter((item) => {
                                  const term = normalizeSearchText(barSearch);
                                  if (!term) return true;
                                  return (
                                    normalizeSearchText(item.name).includes(term) ||
                                    normalizeSearchText(item.description ?? "").includes(term)
                                  );
                                })
                                .map((item) => (
                                  <div
                                    key={item.id}
                                    className="flex h-full flex-col rounded-xl border border-stroke bg-white p-3 shadow-sm dark:border-dark-3 dark:bg-dark-2"
                                  >
                                    <div className="flex-1">
                                      <div className="flex items-start justify-between gap-2">
                                        <div>
                                          <div className="text-sm font-semibold text-dark dark:text-white">
                                            {item.name}
                                          </div>
                                          <div className="text-xs text-dark-6 dark:text-dark-6">
                                            {item.category}
                                          </div>
                                        </div>
                                        <div className="text-sm font-semibold text-primary">
                                          {formatMoney(item.price)}
                                        </div>
                                      </div>
                                      {item.description ? (
                                        <p className="mt-1 text-xs text-dark-6 dark:text-dark-6">
                                          {item.description}
                                        </p>
                                      ) : null}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => addToCart(item)}
                                      className="mt-2 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"
                                    >
                                      Agregar
                                    </button>
                                  </div>
                                ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col overflow-y-auto">
              <h4 className="text-base font-semibold text-dark dark:text-white">Pedido</h4>
              <div className="mt-2 text-sm text-body-color dark:text-dark-6">
                Mesa: {tables.find((t) => t.id === selectedTableId)?.name}
              </div>
              {appendingBaseOrder ? (
                <div className="mt-3 rounded-xl border border-stroke bg-gray-1 p-3 text-sm dark:border-dark-3 dark:bg-dark-2">
                  <div className="mb-2 font-semibold text-dark dark:text-white">
                    Comanda actual #{appendingBaseOrder.id}
                  </div>
                  <div className="max-h-60 overflow-y-auto pr-1 text-xs text-dark dark:text-white">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {appendingBaseOrder.items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-stroke bg-white/80 p-2 dark:border-dark-3 dark:bg-dark-3/30"
                      >
                        <div className="line-clamp-2 font-medium text-dark dark:text-white">
                          {item.quantity} x {item.name}
                        </div>
                        <div className="mt-1 font-semibold text-primary">
                          {formatMoney(Number(item.line_total))}
                        </div>
                      </div>
                    ))}
                    </div>
                  </div>
                  <div className="mt-2 border-t border-stroke pt-2 text-xs text-dark dark:border-dark-3 dark:text-white">
                    Total actual:{" "}
                    <span className="font-semibold">{formatMoney(Number(appendingBaseOrder.total))}</span>
                  </div>
                </div>
              ) : null}

              <div className="mt-3">
                {cartItems.length === 0 ? (
                  <p className="text-sm text-dark-6 dark:text-dark-6">
                    {appendingBaseOrder
                      ? "Agrega nuevos items para añadir a la comanda."
                      : "Agrega items del menú."}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {cartItems.map((ci) => (
                      <div
                        key={ci.menu_item_id}
                        className="rounded-xl border border-stroke bg-gray-1 p-3 text-sm text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 font-semibold">
                            {menuItems.find((m) => m.id === ci.menu_item_id)?.name ?? "Item"}
                          </div>
                          <div className="flex shrink-0 items-start gap-2">
                            <div className="whitespace-nowrap text-primary">
                              {formatMoney(ci.unit_price)}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setCart((prev) => {
                                  const clone = { ...prev };
                                  delete clone[ci.menu_item_id];
                                  return clone;
                                })
                              }
                              className="rounded-lg border border-stroke px-2.5 py-1 text-xs font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <label className="flex items-center gap-1">
                            Cant.
                            <input
                              type="number"
                              min={1}
                              value={ci.quantity}
                              onChange={(e) =>
                                updateCart(ci.menu_item_id, (curr) => ({
                                  ...curr,
                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                }))
                              }
                              className="w-16 rounded border border-stroke bg-transparent px-2 py-1 text-xs dark:border-dark-3"
                            />
                          </label>
                          <label className="flex items-center gap-1">
                            Descuento (COP)
                            <input
                              type="number"
                              min={0}
                              step="1"
                              value={ci.discount_rate ?? ""}
                              onChange={(e) =>
                                updateCart(ci.menu_item_id, (curr) => ({
                                  ...curr,
                                  discount_rate:
                                    e.target.value === ""
                                      ? null
                                      : Math.min(
                                          curr.unit_price * curr.quantity,
                                          Math.max(0, Number(e.target.value) || 0),
                                        ),
                                }))
                              }
                              className="w-24 rounded border border-stroke bg-transparent px-2 py-1 text-xs dark:border-dark-3"
                            />
                          </label>
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={ci.courtesy}
                              onChange={(e) =>
                                updateCart(ci.menu_item_id, (curr) => ({
                                  ...curr,
                                  courtesy: e.target.checked,
                                }))
                              }
                              className="h-4 w-4"
                            />
                            Cortesía
                          </label>
                        </div>
                        <div className="mt-2 text-xs text-body-color dark:text-dark-6">
                          Total línea (base sin INC):{" "}
                          {formatMoney(
                            ci.courtesy
                              ? 0
                              : Math.max(
                                    ci.unit_price * ci.quantity -
                                      Math.min(
                                        ci.unit_price * ci.quantity,
                                        Math.max(0, ci.discount_rate ?? 0),
                                      ),
                                    0,
                                  ),
                          )}
                        </div>
                        <div className="mt-2">
                          <textarea
                            value={ci.note ?? ""}
                            onChange={(e) =>
                              updateCart(ci.menu_item_id, (curr) => ({
                                ...curr,
                                note: e.target.value || null,
                              }))
                            }
                            placeholder="Notas para cocina/bar"
                            rows={2}
                            className="w-full resize-none rounded border border-stroke bg-transparent px-3 py-2 text-xs text-dark outline-none dark:border-dark-3 dark:text-white"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-1 text-sm text-dark dark:text-white">
                <p className="text-[11px] text-body-color dark:text-dark-6">
                  Precios en comanda: base sin INC (8%). La carta del POS sigue mostrando el precio al cliente; el INC se suma al cobrar.
                </p>
                <div className="flex items-center justify-between">
                  <span>Subtotal</span>
                  <span>{formatMoney(cartTotals.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Descuentos</span>
                  <span>{formatMoney(cartTotals.discount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Cortesías</span>
                  <span>{formatMoney(cartTotals.courtesy)}</span>
                </div>
                <p className="text-[11px] text-body-color dark:text-dark-6">{PREFACTURA_INC_FOOTNOTE}</p>
                <div className="flex items-center justify-between text-base font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(cartTotals.total)}</span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCreateOrder}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
                >
                  {appendingBaseOrder ? "Añadir a la comanda" : "Enviar comanda"}
                </button>
                <button
                  type="button"
                  onClick={() => setCart({})}
                  className="rounded-lg border border-stroke px-4 py-2 text-sm font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                >
                  Limpiar
                </button>
                {submitStatus.kind === "error" && (
                  <span className="text-sm font-medium text-red">{submitStatus.message}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ViewOrderModal
        order={viewOrder}
        waiterDisplayName={viewOrder ? resolveWaiterName(viewOrder) : null}
        onClose={() => {
          setViewOrder(null);
          setViewDeleteSuccessMessage(null);
        }}
        canAddToOrder={Boolean(viewOrder && !["closed", "void"].includes(viewOrder.status))}
        onAddToOrder={openAppendOrderFlow}
        canPayOrder={Boolean(viewOrder && !["closed", "void"].includes(viewOrder.status))}
        onPayOrder={openPayOrderFlow}
        deletingItemId={deletingViewItemId}
        onDeleteItem={handleDeleteOrderItem}
        deleteSuccessMessage={viewDeleteSuccessMessage}
      />
    </div>
  );
}
