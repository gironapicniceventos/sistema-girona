"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import type { PurchaseRecord } from "@/components/Dashboard/purchases-metrics-panel";
import {
  aggregateSalesBreakdown,
  filterPurchasesByYmdRange,
  sumPurchaseTotalCost,
} from "@/components/Sales/aggregate-sales-breakdown";
import SalesBreakdownPanel from "@/components/Sales/sales-breakdown-panel";

dayjs.extend(utc);
dayjs.extend(timezone);

const COLOMBIA_TZ = "America/Bogota";

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  datofono: "Datáfono",
  qr: "QR",
  nequi: "Nequi",
  tarjeta: "Tarjeta (histórico)",
  tarjeta_credito: "Tarjeta de crédito (histórico)",
  tarjeta_debito: "Tarjeta de débito (histórico)",
  transferencia: "Transferencia / QR (histórico)",
  billetera: "Billetera / Nequi (histórico)",
  otro: "Otro",
};

type SaleItem = {
  id: number;
  name: string;
  category: string;
  quantity: number | string;
  line_total: number | string;
};

type Sale = {
  id: number;
  order_id: number;
  payment_method?: string | null;
  subtotal: number | string;
  tax_total: number | string;
  discount_total: number | string;
  courtesy_total: number | string;
  service_total: number | string;
  total: number | string;
  created_at: string;
  items: SaleItem[];
};

type SalesByCategory = {
  category: string;
  quantity: number | string;
  total: number | string;
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

function formatQty(value: unknown) {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(num)) return String(value ?? "");
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(num);
}

function formatDateTime(value: string) {
  const withOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const parsed = withOffset ? dayjs(value) : dayjs.tz(value, COLOMBIA_TZ);
  if (!parsed.isValid()) return value;
  return parsed.tz(COLOMBIA_TZ).format("DD/MM/YYYY HH:mm");
}

function payLabel(v: string | null | undefined) {
  if (!v) return "—";
  return PAYMENT_METHOD_LABEL[v] ?? v;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function SalesReportList() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [byCategory, setByCategory] = useState<SalesByCategory[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const rangeApi = useMemo(
    () => ({
      from: rangeStart.format("YYYY-MM-DD"),
      to: rangeEnd.format("YYYY-MM-DD"),
    }),
    [rangeStart, rangeEnd],
  );

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({
      date_from: rangeApi.from,
      date_to: rangeApi.to,
    });
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [salesRes, catRes, purRes] = await Promise.all([
          fetch(`/api/sales?${qs.toString()}`, { cache: "no-store" }),
          fetch(`/api/sales/summary/categories?${qs.toString()}`, { cache: "no-store" }),
          fetch("/api/inventory/purchases", { cache: "no-store" }),
        ]);
        const salesPayload = await safeJson(salesRes);
        const catPayload = await safeJson(catRes);
        const purPayload = await safeJson(purRes);
        if (cancelled) return;
        if (!salesRes.ok) {
          throw new Error(
            (typeof (salesPayload as { message?: string })?.message === "string" &&
              (salesPayload as { message: string }).message) ||
              "No se pudo cargar las ventas",
          );
        }
        if (!catRes.ok) {
          throw new Error(
            (typeof (catPayload as { message?: string })?.message === "string" &&
              (catPayload as { message: string }).message) ||
              "No se pudo cargar el resumen por categoria",
          );
        }
        setSales(Array.isArray(salesPayload) ? (salesPayload as Sale[]) : []);
        setByCategory(
          Array.isArray(catPayload) ? (catPayload as SalesByCategory[]) : [],
        );
        setPurchases(
          purRes.ok && Array.isArray(purPayload) ? (purPayload as PurchaseRecord[]) : [],
        );
      } catch (e) {
        if (!cancelled) {
          setSales([]);
          setByCategory([]);
          setPurchases([]);
          setLoadError(e instanceof Error ? e.message : "Error cargando el informe");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeApi.from, rangeApi.to]);

  const totalSold = useMemo(
    () =>
      sales.reduce(
        (acc, s) => acc + (typeof s.total === "number" ? s.total : Number.parseFloat(String(s.total)) || 0),
        0,
      ),
    [sales],
  );

  const reportBreakdown = useMemo(() => aggregateSalesBreakdown(sales), [sales]);
  const purchasesInRange = useMemo(
    () => filterPurchasesByYmdRange(purchases, rangeStart, rangeEnd),
    [purchases, rangeStart, rangeEnd],
  );
  const totalPurchasesInRange = useMemo(
    () => sumPurchaseTotalCost(purchasesInRange),
    [purchasesInRange],
  );

  const categoryGrandQty = useMemo(
    () =>
      byCategory.reduce(
        (acc, r) =>
          acc + (typeof r.quantity === "number" ? r.quantity : Number.parseFloat(String(r.quantity)) || 0),
        0,
      ),
    [byCategory],
  );
  const categoryGrandTotal = useMemo(
    () =>
      byCategory.reduce(
        (acc, r) => acc + (typeof r.total === "number" ? r.total : Number.parseFloat(String(r.total)) || 0),
        0,
      ),
    [byCategory],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-[10px] bg-white p-6 shadow-1 dark:bg-gray-dark dark:shadow-card">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-dark dark:text-white">Informe de ventas</h2>
            <p className="text-sm text-body-color dark:text-dark-6">
              Ventas y totales por categoria de items (lineas de venta) segun la fecha de registro. Zona
              horaria: Colombia.
            </p>
            <p className="mt-1 text-sm font-medium text-dark dark:text-white">{rangeLabel}</p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={rangeMode}
                onChange={(e) => setRangeMode(e.target.value as "month" | "day" | "custom")}
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
                    className="h-9 rounded-md border border-stroke bg-white px-2 text-sm text-dark shadow-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                  />
                  <span className="text-sm text-body">a</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="h-9 rounded-md border border-stroke bg-white px-2 text-sm text-dark shadow-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                  />
                </div>
              ) : rangeMode === "day" ? (
                <input
                  type="date"
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value)}
                  className="h-9 rounded-md border border-stroke bg-white px-2 text-sm text-dark shadow-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                />
              ) : (
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="h-9 rounded-md border border-stroke bg-white px-2 text-sm text-dark shadow-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                />
              )}
            </div>
            <Link
              href="/sales"
              className="rounded-md border border-stroke px-4 py-2 text-center text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              Volver a ventas
            </Link>
          </div>
        </div>

        {loadError ? (
          <p className="text-sm text-red">{loadError}</p>
        ) : null}

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-white/5">
            <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Ventas (registros)</p>
            <p className="mt-1 text-lg font-semibold text-black dark:text-white">
              {loading ? "—" : sales.length}
            </p>
          </div>
          <div className="rounded-md border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-white/5">
            <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Total facturado</p>
            <p className="mt-1 text-lg font-semibold text-black dark:text-white">
              {loading ? "—" : formatMoney(totalSold)}
            </p>
          </div>
          <div className="rounded-md border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-white/5">
            <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Items (uds. lineas)</p>
            <p className="mt-1 text-lg font-semibold text-black dark:text-white">
              {loading ? "—" : formatQty(categoryGrandQty)}
            </p>
          </div>
        </div>

        <div className="mb-6">
          <SalesBreakdownPanel
            title="Desglose del informe (mismo rango de fechas)"
            subtitle={`Rango: ${rangeLabel}. Compras (egresos) suman entradas de inventario cuya fecha de registro cae en este rango, en zona Colombia.`}
            loading={loading}
            breakdown={reportBreakdown}
            purchasesTotal={totalPurchasesInRange}
            formatMoney={(v) => formatMoney(v)}
          />
        </div>

        <h3 className="mb-2 text-sm font-semibold text-dark dark:text-white">Por categoria (items vendidos)</h3>
        {loading ? (
          <p className="text-sm text-body-color">Cargando...</p>
        ) : byCategory.length === 0 ? (
          <p className="text-sm text-body-color">No hay ventas en este rango.</p>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full table-auto text-sm">
              <thead>
                <tr className="bg-gray-2 text-left dark:bg-dark-2">
                  <th className="px-4 py-2 font-medium text-dark dark:text-white">Categoria</th>
                  <th className="px-4 py-2 font-medium text-dark dark:text-white">Cantidad</th>
                  <th className="px-4 py-2 text-right font-medium text-dark dark:text-white">Total</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((row) => (
                  <tr
                    key={row.category || "—"}
                    className="border-b border-stroke dark:border-dark-3"
                  >
                    <td className="px-4 py-2 text-body-color dark:text-dark-6">{row.category || "—"}</td>
                    <td className="px-4 py-2 text-body-color dark:text-dark-6">{formatQty(row.quantity)}</td>
                    <td className="px-4 py-2 text-right font-medium text-dark dark:text-white">
                      {formatMoney(row.total)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-1 font-semibold dark:bg-dark-2/50">
                  <td className="px-4 py-2 text-dark dark:text-white">Total categorias</td>
                  <td className="px-4 py-2 text-dark dark:text-white">{formatQty(categoryGrandQty)}</td>
                  <td className="px-4 py-2 text-right text-dark dark:text-white">
                    {formatMoney(categoryGrandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-xs text-body-color dark:text-dark-6">
              Los importes por categoria se suman desde las lineas de venta; puede diferir levemente del
              total de facturas por descuentos a nivel de pedido.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-[10px] bg-white p-6 shadow-1 dark:bg-gray-dark dark:shadow-card">
        <h3 className="mb-2 text-sm font-semibold text-dark dark:text-white">Listado de ventas</h3>
        {loading ? (
          <p className="text-sm text-body-color">Cargando...</p>
        ) : sales.length === 0 ? (
          <p className="text-sm text-body-color">No hay ventas en este rango.</p>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full table-auto text-sm">
              <thead>
                <tr className="bg-gray-2 text-left dark:bg-dark-2">
                  <th className="px-3 py-2 font-medium text-dark dark:text-white">Venta</th>
                  <th className="px-3 py-2 font-medium text-dark dark:text-white">Pedido</th>
                  <th className="px-3 py-2 font-medium text-dark dark:text-white">Fecha</th>
                  <th className="px-3 py-2 font-medium text-dark dark:text-white">Medio de pago</th>
                  <th className="px-3 py-2 text-right font-medium text-dark dark:text-white">Subtotal</th>
                  <th className="px-3 py-2 text-right font-medium text-dark dark:text-white">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="border-b border-stroke dark:border-dark-3">
                    <td className="px-3 py-2 font-medium text-dark dark:text-white">#{s.id}</td>
                    <td className="px-3 py-2 text-body-color">#{s.order_id}</td>
                    <td className="px-3 py-2 text-body-color whitespace-nowrap">
                      {formatDateTime(s.created_at)}
                    </td>
                    <td className="px-3 py-2 text-body-color">{payLabel(s.payment_method)}</td>
                    <td className="px-3 py-2 text-right text-body-color">{formatMoney(s.subtotal)}</td>
                    <td className="px-3 py-2 text-right font-medium text-dark dark:text-white">
                      {formatMoney(s.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
