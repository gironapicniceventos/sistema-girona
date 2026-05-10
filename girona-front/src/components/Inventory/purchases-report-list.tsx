"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import jsPDF from "jspdf";

dayjs.extend(utc);
dayjs.extend(timezone);

const COLOMBIA_TZ = "America/Bogota";

type PurchaseItem = {
  id: number;
  product_id: number | null;
  is_other_expense?: boolean;
  product_name: string | null;
  quantity: string;
  unit_cost: string;
  iva_rate?: string;
  line_iva?: string;
  line_subtotal?: string;
  line_total: string;
};

type Purchase = {
  id: number;
  supplier_id: number | null;
  supplier_name?: string | null;
  purchased_at: string | null;
  received_at: string | null;
  total_cost: string;
  subtotal_net?: string;
  total_iva?: string;
  created_at: string;
  items: PurchaseItem[];
};

function lineSubtotalCop(it: PurchaseItem): number {
  const sub = Number.parseFloat(String(it.line_subtotal ?? ""));
  if (Number.isFinite(sub)) return sub;
  const total = Number.parseFloat(String(it.line_total));
  const iva = Number.parseFloat(String(it.line_iva ?? "0"));
  if (Number.isFinite(total) && Number.isFinite(iva)) return total - iva;
  return Number.isFinite(total) ? total : 0;
}

function lineIvaCop(it: PurchaseItem): number {
  const v = Number.parseFloat(String(it.line_iva ?? ""));
  return Number.isFinite(v) ? v : 0;
}

function formatCop(value: unknown) {
  const asNumber = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(asNumber)) return String(value ?? "");
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(asNumber);
}

function formatQty(value: unknown) {
  const asNumber = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(asNumber)) return String(value ?? "");
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(asNumber));
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const withOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const parsed = withOffset ? dayjs(value) : dayjs.tz(value, COLOMBIA_TZ);
  return parsed.isValid() ? parsed.tz(COLOMBIA_TZ) : null;
}

function purchaseRefDate(p: Purchase) {
  return parseDate(p.received_at ?? p.purchased_at ?? p.created_at);
}

function inDateRange(
  p: Purchase,
  rangeStart: Dayjs,
  rangeEnd: Dayjs,
) {
  const d = purchaseRefDate(p);
  if (!d) return false;
  return !d.isBefore(rangeStart, "day") && !d.isAfter(rangeEnd, "day");
}

/** jsPDF default font is Latin-1; evita acentos rotos en titulos. */
function pdfText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildPurchasesPdf(
  list: Purchase[],
  rangeLabel: string,
) {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = 16;
  doc.setFontSize(16);
  doc.text(pdfText("Informe de compras"), margin, y);
  y += 10;
  doc.setFontSize(10);
  doc.text(pdfText(`Periodo: ${rangeLabel}`), margin, y);
  y += 6;
  const now = new Date();
  doc.text(
    pdfText(
      `Generado: ${now.toLocaleString("es-CO", { timeZone: "America/Bogota" })}`,
    ),
    margin,
    y,
  );
  y += 12;
  if (list.length === 0) {
    doc.setFontSize(11);
    doc.text(pdfText("No hay compras en este rango."), margin, y);
    doc.save(`informe-compras-vacio-${dayjs().format("YYYY-MM-DD")}.pdf`);
    return;
  }

  let totalSum = 0;
  for (const p of list) {
    const t = Number.parseFloat(String(p.total_cost));
    if (Number.isFinite(t)) totalSum += t;
  }

  for (const p of list) {
    if (y > 255) {
      doc.addPage();
      y = 16;
    }
    const proveedor =
      (p.supplier_name && String(p.supplier_name).trim()) ||
      (p.supplier_id != null ? `#${p.supplier_id}` : "—");
    const pSub = Number.parseFloat(String(p.subtotal_net ?? ""));
    const pIva = Number.parseFloat(String(p.total_iva ?? ""));
    const extraTotals =
      Number.isFinite(pSub) && Number.isFinite(pIva)
        ? pdfText(`  · Neto ${formatCop(pSub)} · IVA ${formatCop(pIva)}`)
        : "";
    const fecha = p.received_at
      ? new Date(p.received_at).toLocaleString("es-CO")
      : "—";
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(
      pdfText(
        `Compra #${p.id}  ·  Tot ${formatCop(p.total_cost)}  ·  ${proveedor}`,
      ),
      margin,
      y,
    );
    y += 5;
    if (extraTotals) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(extraTotals, margin, y);
      y += 6;
    } else {
      y += 1;
    }
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(pdfText(`Recibida: ${fecha}`), margin, y);
    y += 6;
    if (p.items?.length) {
      doc.text(pdfText("Items:"), margin, y);
      y += 5;
      for (const it of p.items) {
        if (y > 280) {
          doc.addPage();
          y = 16;
        }
        const label = (it.product_name?.trim()
          ? it.product_name
          : it.product_id != null
            ? `#${it.product_id}`
            : "—") ?? "";
        const sub = lineSubtotalCop(it);
        const ivaL = lineIvaCop(it);
        const line = `  - ${label}  |  ${formatQty(
          it.quantity,
        )}  |  c/u ${formatCop(it.unit_cost)}  |  Neto ${formatCop(sub)}  |  IVA ${formatCop(ivaL)}  |  Tot ${formatCop(
          it.line_total,
        )}`;
        const split = doc.splitTextToSize(pdfText(line), pageW - margin * 2);
        for (const piece of split) {
          doc.text(piece, margin, y);
          y += 4;
        }
        if (y > 280) {
          doc.addPage();
          y = 16;
        }
      }
    }
    y += 4;
  }

  if (y > 270) {
    doc.addPage();
    y = 16;
  }
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(pdfText(`Total en periodo: ${formatCop(totalSum)}`), margin, y);

  doc.save(pdfText(`informe-compras-${dayjs().format("YYYY-MM-DD_HHmmss")}.pdf`));
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function PurchasesReportList() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeMode, setRangeMode] = useState<"month" | "day" | "custom">("month");
  const [selectedMonth, setSelectedMonth] = useState(() =>
    dayjs().tz(COLOMBIA_TZ).format("YYYY-MM"),
  );
  const [selectedDay, setSelectedDay] = useState(() =>
    dayjs().tz(COLOMBIA_TZ).format("YYYY-MM-DD"),
  );
  const [customStart, setCustomStart] = useState(() =>
    dayjs().tz(COLOMBIA_TZ).subtract(1, "month").format("YYYY-MM-DD"),
  );
  const [customEnd, setCustomEnd] = useState(() =>
    dayjs().tz(COLOMBIA_TZ).format("YYYY-MM-DD"),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/inventory/purchases", { cache: "no-store" });
        const payload = await safeJson(res);
        if (cancelled) return;
        setPurchases(Array.isArray(payload) ? (payload as Purchase[]) : []);
      } catch {
        if (!cancelled) setPurchases([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const now = dayjs().tz(COLOMBIA_TZ);
  const defaultEnd = now.startOf("day");

  const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
    if (rangeMode === "custom") {
      const startCandidate = dayjs.tz(customStart, COLOMBIA_TZ).startOf("day");
      const endCandidate = dayjs.tz(customEnd, COLOMBIA_TZ).startOf("day");
      const validStart = startCandidate.isValid() ? startCandidate : defaultEnd;
      const validEnd = endCandidate.isValid() ? endCandidate : defaultEnd;
      const start = validStart.isAfter(validEnd) ? validEnd : validStart;
      const end = validStart.isAfter(validEnd) ? validStart : validEnd;
      return {
        rangeStart: start,
        rangeEnd: end,
        rangeLabel: `Del ${start.format("DD/MM/YYYY")} al ${end.format("DD/MM/YYYY")}`,
      };
    }
    if (rangeMode === "day") {
      const dayCandidate = dayjs.tz(selectedDay, COLOMBIA_TZ).startOf("day");
      const start = dayCandidate.isValid() ? dayCandidate : defaultEnd;
      return {
        rangeStart: start,
        rangeEnd: start,
        rangeLabel: `Dia ${start.format("DD/MM/YYYY")}`,
      };
    }
    const monthStart = dayjs.tz(`${selectedMonth}-01`, COLOMBIA_TZ).startOf("month");
    const start = monthStart.isValid() ? monthStart : defaultEnd.startOf("month");
    const end = start.endOf("month").startOf("day");
    const label = new Intl.DateTimeFormat("es-CO", {
      month: "long",
      year: "numeric",
      timeZone: COLOMBIA_TZ,
    }).format(start.toDate());
    return { rangeStart: start, rangeEnd: end, rangeLabel: label };
  }, [rangeMode, selectedMonth, selectedDay, customStart, customEnd, defaultEnd]);

  const filteredPurchases = useMemo(
    () => purchases.filter((p) => inDateRange(p, rangeStart, rangeEnd)),
    [purchases, rangeStart, rangeEnd],
  );

  return (
    <div className="rounded-[10px] bg-white p-6 shadow-1 dark:bg-gray-dark dark:shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-dark dark:text-white">
            Compras registradas
          </h2>
          <p className="text-sm text-body-color dark:text-dark-6">
            {rangeLabel} · {filteredPurchases.length} registro
            {filteredPurchases.length === 1 ? "" : "s"}
            {purchases.length
              ? ` de ${purchases.length} en total`
              : ""}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={rangeMode}
              onChange={(e) =>
                setRangeMode(e.target.value as "month" | "day" | "custom")
              }
              className="h-9 rounded-md border border-stroke bg-white px-3 text-sm text-dark shadow-sm outline-none transition focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            >
              <option value="month">Mes especifico</option>
              <option value="day">Dia especifico</option>
              <option value="custom">Rango personalizado</option>
            </select>
            {rangeMode === "custom" ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-9 rounded-md border border-stroke bg-white px-2 text-sm text-dark shadow-sm outline-none transition focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                />
                <span className="text-sm text-body">a</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-9 rounded-md border border-stroke bg-white px-2 text-sm text-dark shadow-sm outline-none transition focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                />
              </div>
            ) : rangeMode === "day" ? (
              <input
                type="date"
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="h-9 rounded-md border border-stroke bg-white px-2 text-sm text-dark shadow-sm outline-none transition focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                title="Elegi un dia concreto"
              />
            ) : (
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-9 rounded-md border border-stroke bg-white px-2 text-sm text-dark shadow-sm outline-none transition focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => buildPurchasesPdf(filteredPurchases, rangeLabel)}
              className="rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-white hover:bg-primary/90"
            >
              Descargar PDF
            </button>
            <Link
              href="/inventory"
              className="rounded-md border border-stroke px-4 py-2 text-center text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              Volver a inventario
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-full overflow-x-auto">
        {loading ? (
          <p className="px-4 py-6 text-sm text-body-color">Cargando informe…</p>
        ) : (
          <table className="w-full table-auto">
            <thead>
              <tr className="bg-gray-2 text-left dark:bg-dark-2">
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">ID</th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">
                  Proveedor
                </th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">
                  Recibida
                </th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">Items</th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">Total</th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">Neto</th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">IVA</th>
              </tr>
            </thead>
            <tbody>
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-sm text-body-color dark:text-dark-6"
                  >
                    No hay compras en este rango.
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="border-b border-stroke dark:border-dark-3">
                      <td className="px-4 py-3 text-sm text-dark dark:text-white">{p.id}</td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {(p.supplier_name && p.supplier_name.trim()) || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {p.received_at
                          ? new Date(p.received_at).toLocaleString("es-CO")
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {p.items?.length ?? 0}
                      </td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {formatCop(p.total_cost)}
                      </td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {p.subtotal_net != null ? formatCop(p.subtotal_net) : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {p.total_iva != null ? formatCop(p.total_iva) : "—"}
                      </td>
                    </tr>
                    <tr className="border-b border-stroke dark:border-dark-3">
                      <td colSpan={7} className="px-4 pb-4 pt-2">
                        <div className="rounded-md border border-stroke bg-white p-3 text-sm dark:border-dark-3 dark:bg-dark-2">
                          <div className="mb-2 text-xs font-semibold uppercase text-dark-6 dark:text-dark-6">
                            Items comprados
                          </div>
                          {p.items?.length ? (
                            <div className="max-w-full overflow-x-auto">
                              <table className="w-full table-auto text-sm">
                                <thead>
                                  <tr className="text-left text-xs uppercase text-dark-6 dark:text-dark-6">
                                    <th className="px-2 py-1">Producto</th>
                                    <th className="px-2 py-1">Cantidad</th>
                                    <th className="px-2 py-1">Costo u.</th>
                                    <th className="px-2 py-1">Neto</th>
                                    <th className="px-2 py-1">IVA</th>
                                    <th className="px-2 py-1">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.items.map((item) => (
                                    <tr key={item.id}>
                                      <td className="px-2 py-1 text-dark dark:text-white">
                                        {item.product_name?.trim()
                                          ? item.product_name
                                          : item.product_id != null
                                            ? `#${item.product_id}`
                                            : "—"}
                                      </td>
                                      <td className="px-2 py-1 text-body-color dark:text-dark-6">
                                        {formatQty(item.quantity)}
                                      </td>
                                      <td className="px-2 py-1 text-body-color dark:text-dark-6">
                                        {formatCop(item.unit_cost)}
                                      </td>
                                      <td className="px-2 py-1 text-body-color dark:text-dark-6">
                                        {formatCop(lineSubtotalCop(item))}
                                      </td>
                                      <td className="px-2 py-1 text-body-color dark:text-dark-6">
                                        {formatCop(lineIvaCop(item))}
                                      </td>
                                      <td className="px-2 py-1 text-body-color dark:text-dark-6">
                                        {formatCop(item.line_total)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="text-body-color dark:text-dark-6">
                              Sin items registrados.
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
