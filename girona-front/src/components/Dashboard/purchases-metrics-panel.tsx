"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { useMemo, useState } from "react";

dayjs.extend(utc);
dayjs.extend(timezone);

const COLOMBIA_TZ = "America/Bogota";

export type PurchaseRecord = {
  id: number;
  total_cost: number | string;
  created_at: string;
  supplier_id?: number | null;
  supplier_name?: string | null;
  items?: {
    id: number;
    product_id?: number | null;
    is_other_expense?: boolean;
    product_name?: string | null;
    line_total?: string | number;
  }[];
};

function safeNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(value: unknown) {
  const num = safeNumber(value);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(num);
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const withOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const parsed = withOffset ? dayjs(value) : dayjs.tz(value, COLOMBIA_TZ);
  return parsed.isValid() ? parsed.tz(COLOMBIA_TZ) : null;
}

function isOnOrAfter(date: dayjs.Dayjs, reference: dayjs.Dayjs) {
  return date.isAfter(reference) || date.isSame(reference);
}

function lineProductLabel(item: {
  product_id?: number | null;
  product_name?: string | null;
}) {
  const name = (item.product_name ?? "").trim();
  if (name) return name;
  if (item.product_id != null) return `#${item.product_id}`;
  return "—";
}

function purchaseProductFullList(p: PurchaseRecord) {
  const items = p.items ?? [];
  if (items.length === 0) return "";
  return items.map((i) => lineProductLabel(i)).join(", ");
}

function purchaseProductSummary(p: PurchaseRecord) {
  const items = p.items ?? [];
  if (items.length === 0) return "—";
  const labels = items.map((i) => lineProductLabel(i));
  if (labels.length === 1) return labels[0];
  const first = labels[0] ?? "—";
  if (first === "—" && labels.every((l) => l === "—")) return "—";
  const extra = items.length - 1;
  return `${first} · +${extra} ${extra === 1 ? "línea" : "líneas"}`;
}

function purchaseSupplierLabel(p: PurchaseRecord) {
  const n = p.supplier_name?.trim();
  if (n) return n;
  if (p.supplier_id != null) return `Proveedor #${p.supplier_id}`;
  return "—";
}

type Props = {
  purchases: PurchaseRecord[];
  loading: boolean;
};

export default function PurchasesMetricsPanel({ purchases, loading }: Props) {
  const [selectedDay, setSelectedDay] = useState("");

  const now = dayjs().tz(COLOMBIA_TZ);
  const todayStart = now.startOf("day");
  const weekStart = now.subtract(6, "day").startOf("day");
  const monthStart = now.subtract(29, "day").startOf("day");

  const purchases30Days = useMemo(() => {
    return purchases.filter((purchase) => {
      const created = parseDate(purchase.created_at);
      return created ? isOnOrAfter(created, monthStart) : false;
    });
  }, [purchases, monthStart]);

  const purchasesToday = useMemo(() => {
    return purchases.filter((purchase) => {
      const created = parseDate(purchase.created_at);
      return created ? isOnOrAfter(created, todayStart) : false;
    });
  }, [purchases, todayStart]);

  const purchases7Days = useMemo(() => {
    return purchases.filter((purchase) => {
      const created = parseDate(purchase.created_at);
      return created ? isOnOrAfter(created, weekStart) : false;
    });
  }, [purchases, weekStart]);

  const recentPurchases = useMemo(() => {
    return [...purchases]
      .filter((p) => parseDate(p.created_at))
      .sort((a, b) => {
        const db = parseDate(b.created_at)?.valueOf() ?? 0;
        const da = parseDate(a.created_at)?.valueOf() ?? 0;
        return db - da;
      })
      .slice(0, 8);
  }, [purchases]);

  const purchasesOnSelectedDay = useMemo(() => {
    if (!selectedDay.trim()) return null;
    const day = dayjs.tz(selectedDay, COLOMBIA_TZ).startOf("day");
    if (!day.isValid()) return [];
    return [...purchases]
      .filter((p) => {
        const c = parseDate(p.created_at);
        return c ? c.isSame(day, "day") : false;
      })
      .sort((a, b) => {
        const db = parseDate(b.created_at)?.valueOf() ?? 0;
        const da = parseDate(a.created_at)?.valueOf() ?? 0;
        return db - da;
      });
  }, [purchases, selectedDay]);

  const dayFilterTotal = useMemo(() => {
    if (!purchasesOnSelectedDay) return 0;
    return purchasesOnSelectedDay.reduce((acc, p) => acc + safeNumber(p.total_cost), 0);
  }, [purchasesOnSelectedDay]);

  const totalExpenses30Days = purchases30Days.reduce(
    (acc, purchase) => acc + safeNumber(purchase.total_cost),
    0,
  );
  const totalExpensesToday = purchasesToday.reduce(
    (acc, purchase) => acc + safeNumber(purchase.total_cost),
    0,
  );
  const totalExpenses7Days = purchases7Days.reduce(
    (acc, purchase) => acc + safeNumber(purchase.total_cost),
    0,
  );

  return (
    <div className="rounded-sm border border-stroke border-l-4 border-l-secondary bg-white p-6 shadow-default dark:border-dark-3 dark:border-l-secondary dark:bg-gray-dark">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-black dark:text-white">
            Compras / Pagos y registros
          </h3>
          <p className="mt-1 text-sm text-body">
            Egresos a proveedores por compras registradas. Sirve para contrastar caja, inventario y
            métricas de gasto frente a las ventas de esta sección.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/compras/proveedores"
            className="rounded-md border border-stroke bg-white px-3 py-2 text-sm font-medium text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:hover:bg-dark-3"
          >
            Registrar compra
          </Link>
          <Link
            href="/inventory/purchases"
            className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-white transition hover:bg-secondary/90"
          >
            Informe y registros
          </Link>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-md border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-white/5">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Egresos hoy</p>
          <p className="mt-1 text-lg font-semibold text-black dark:text-white">
            {formatMoney(totalExpensesToday)}
          </p>
          <p className="text-xs text-body-color dark:text-dark-6">
            {purchasesToday.length} registro{purchasesToday.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-md border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-white/5">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Egresos 7 días</p>
          <p className="mt-1 text-lg font-semibold text-black dark:text-white">
            {formatMoney(totalExpenses7Days)}
          </p>
          <p className="text-xs text-body-color dark:text-dark-6">
            {purchases7Days.length} órdenes de compra
          </p>
        </div>
        <div className="rounded-md border border-stroke bg-gray-1 px-4 py-3 dark:border-dark-3 dark:bg-white/5">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Egresos 30 días</p>
          <p className="mt-1 text-lg font-semibold text-black dark:text-white">
            {formatMoney(totalExpenses30Days)}
          </p>
          <p className="text-xs text-body-color dark:text-dark-6">Mismo criterio que ingresos (30 días)</p>
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h4 className="text-sm font-semibold text-black dark:text-white">
            {selectedDay && dayjs.tz(selectedDay, COLOMBIA_TZ).isValid()
              ? `Compras del ${dayjs.tz(selectedDay, COLOMBIA_TZ).format("DD/MM/YYYY")}`
              : "Últimas compras registradas"}
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="purchases-day-filter"
              className="text-sm text-body dark:text-dark-6"
            >
              Revisar por día
            </label>
            <input
              id="purchases-day-filter"
              type="date"
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
              className="h-9 rounded-md border border-stroke bg-white px-2 text-sm text-dark shadow-sm outline-none transition focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            />
            {selectedDay ? (
              <button
                type="button"
                onClick={() => setSelectedDay("")}
                className="h-9 rounded-md border border-stroke bg-white px-2 text-sm font-medium text-body hover:bg-gray-2 dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:hover:bg-dark-3"
              >
                Quitar filtro
              </button>
            ) : null}
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-body">Cargando...</p>
        ) : selectedDay.trim() && (purchasesOnSelectedDay?.length ?? 0) === 0 ? (
          <p className="text-sm text-body">
            No hay compras registradas con esta fecha. Probá otra o quitá el filtro para ver las
            últimas.
          </p>
        ) : !selectedDay && recentPurchases.length === 0 ? (
          <p className="text-sm text-body">Aún no hay compras registradas en el sistema.</p>
        ) : (
          <div className="max-w-full space-y-2 overflow-x-auto">
            {selectedDay.trim() && (purchasesOnSelectedDay?.length ?? 0) > 0 ? (
              <p className="text-sm text-body dark:text-dark-6">
                <span className="font-semibold text-black dark:text-white">
                  {formatMoney(dayFilterTotal)}
                </span>{" "}
                en {purchasesOnSelectedDay?.length ?? 0} compra
                {(purchasesOnSelectedDay?.length ?? 0) === 1 ? "" : "s"} (fecha de registro)
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/10 text-secondary hover:bg-secondary/10 dark:hover:bg-secondary/10">
                  <TableHead>Fecha</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Líneas</TableHead>
                  <TableHead className="text-right">Total (egreso)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(selectedDay.trim() ? (purchasesOnSelectedDay ?? []) : recentPurchases).map(
                  (row) => {
                  const when = parseDate(row.created_at);
                  return (
                    <TableRow key={row.id} className="transition-colors hover:bg-secondary/5">
                      <TableCell className="text-body-color dark:text-dark-6">
                        {when ? when.format("DD/MM/YYYY HH:mm") : "-"}
                      </TableCell>
                      <TableCell className="font-medium text-black dark:text-white">#{row.id}</TableCell>
                      <TableCell
                        className="max-w-[200px] text-body-color dark:text-dark-6"
                        title={purchaseProductFullList(row)}
                      >
                        {purchaseProductSummary(row)}
                      </TableCell>
                      <TableCell className="max-w-[180px] text-body-color dark:text-dark-6">
                        {purchaseSupplierLabel(row)}
                      </TableCell>
                      <TableCell>{row.items?.length ?? 0}</TableCell>
                      <TableCell className="text-right font-semibold text-black dark:text-white">
                        {formatMoney(row.total_cost)}
                      </TableCell>
                    </TableRow>
                  );
                  },
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
