"use client";

import PurchasesMetricsPanel, {
  type PurchaseRecord,
} from "@/components/Dashboard/purchases-metrics-panel";
import {
  aggregateSalesBreakdown,
  filterPurchasesByTimeFilter,
  sumPurchaseTotalCost,
} from "@/components/Sales/aggregate-sales-breakdown";
import SalesBreakdownPanel from "@/components/Sales/sales-breakdown-panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableScroll } from "@/components/ui/scroll-table";
import Link from "next/link";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { useCallback, useEffect, useMemo, useState } from "react";

dayjs.extend(utc);
dayjs.extend(timezone);

const COLOMBIA_TZ = "America/Bogota";

type SaleItem = {
  id: number;
  menu_item_id: number;
  name: string;
  category: string;
  quantity: number | string;
  unit_price: number | string;
  tax_rate: number | string;
  line_subtotal: number | string;
  line_tax: number | string;
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
  discount_count: number | string;
  courtesy_count: number | string;
  service_total: number | string;
  total: number | string;
  created_at: string;
  electronic_invoice_status?: string | null;
  electronic_invoice_number?: string | null;
  electronic_invoice_environment?: string | null;
  electronic_invoice_cufe?: string | null;
  electronic_invoice_qr_url?: string | null;
  electronic_invoice_email_status?: string | null;
  electronic_invoice_email_address?: string | null;
  electronic_invoice_email_error?: string | null;
  items: SaleItem[];
};

type SalesByProduct = {
  menu_item_id: number;
  name: string;
  category: string;
  quantity: number | string;
  total: number | string;
};

type SalesByCategory = {
  category: string;
  quantity: number | string;
  total: number | string;
};

type SalesByWaiter = {
  waiter_id: number | null;
  name: string;
  quantity: number | string;
  service_total: number | string;
  total: number | string;
};

type SalesByTable = {
  table_id: number | null;
  name: string | null;
  is_active: boolean | null;
  quantity: number | string;
  total: number | string;
};

type SalesAdjustmentsByMonth = {
  year: number | string;
  month: number | string;
  courtesy_count: number | string;
  discount_count: number | string;
};

const SALES_HISTORY_PAGE_SIZE = 10;
const ADJUSTMENTS_MONTHLY_PAGE_SIZE = 8;
const SALES_BY_PRODUCT_PAGE_SIZE = 8;
const SALES_BY_CATEGORY_PAGE_SIZE = 8;
const SALES_BY_WAITER_PAGE_SIZE = 8;
const SALES_BY_TABLE_PAGE_SIZE = 8;
type TimeFilter = "all" | "week" | "month" | "quarter" | "year";

const TIME_FILTER_OPTIONS: Array<{ value: TimeFilter; label: string }> = [
  { value: "all", label: "Mostrar todo" },
  { value: "week", label: "Semana" },
  { value: "month", label: "1 mes" },
  { value: "quarter", label: "3 meses" },
  { value: "year", label: "Año" },
];

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

function salePaymentMethodLabel(v: string | null | undefined) {
  if (!v) return "—";
  return PAYMENT_METHOD_LABEL[v] ?? v;
}

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

function formatQty(value: unknown) {
  const num = safeNumber(value);
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(num);
}

function formatCount(value: unknown) {
  const num = safeNumber(value);
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(num);
}

function formatDate(value: string) {
  const withOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const parsed = withOffset ? dayjs(value) : dayjs.tz(value, COLOMBIA_TZ);
  if (!parsed.isValid()) return value;
  return parsed.tz(COLOMBIA_TZ).format("DD/MM/YYYY HH:mm");
}

function formatMonthLabel(year: unknown, month: unknown) {
  const parsedYear = Math.max(0, Math.trunc(safeNumber(year)));
  const parsedMonth = Math.max(1, Math.min(12, Math.trunc(safeNumber(month))));
  const monthNames = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  return `${monthNames[parsedMonth - 1]} ${parsedYear}`;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function PaginationControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (nextPage: number) => void;
}) {
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-body">{`Página ${page} de ${totalPages}`}</p>
      <div className="flex max-w-full flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded border border-stroke px-2 py-1 text-xs text-dark hover:bg-gray-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
        >
          Anterior
        </button>
        {pages.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onPageChange(pageNumber)}
            className={
              "rounded border px-2 py-1 text-xs " +
              (pageNumber === page
                ? "border-primary bg-primary text-white"
                : "border-stroke text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2")
            }
          >
            {pageNumber}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded border border-stroke px-2 py-1 text-xs text-dark hover:bg-gray-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function TimeFilterSelect({
  value,
  onChange,
}: {
  value: TimeFilter;
  onChange: (nextValue: TimeFilter) => void;
}) {
  return (
    <label className="flex w-full min-w-0 flex-col gap-1 text-sm text-body sm:w-auto sm:flex-row sm:items-center sm:gap-2">
      <span className="shrink-0">Tiempo</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as TimeFilter)}
        className="w-full min-w-0 rounded-md border border-stroke bg-white px-2 py-1.5 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white sm:w-auto sm:min-w-[11rem] sm:py-1"
      >
        {TIME_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [salesByProduct, setSalesByProduct] = useState<SalesByProduct[]>([]);
  const [salesByCategory, setSalesByCategory] = useState<SalesByCategory[]>([]);
  const [salesByWaiter, setSalesByWaiter] = useState<SalesByWaiter[]>([]);
  const [salesByTable, setSalesByTable] = useState<SalesByTable[]>([]);
  const [salesAdjustmentsByMonth, setSalesAdjustmentsByMonth] = useState<
    SalesAdjustmentsByMonth[]
  >([]);
  const [salesHistoryPage, setSalesHistoryPage] = useState(1);
  const [salesByProductPage, setSalesByProductPage] = useState(1);
  const [salesByCategoryPage, setSalesByCategoryPage] = useState(1);
  const [salesByWaiterPage, setSalesByWaiterPage] = useState(1);
  const [salesByTablePage, setSalesByTablePage] = useState(1);
  const [adjustmentsMonthlyPage, setAdjustmentsMonthlyPage] = useState(1);
  const [salesHistoryFilter, setSalesHistoryFilter] = useState<TimeFilter>("all");
  const [salesByProductFilter, setSalesByProductFilter] = useState<TimeFilter>("all");
  const [salesByCategoryFilter, setSalesByCategoryFilter] = useState<TimeFilter>("all");
  const [salesByWaiterFilter, setSalesByWaiterFilter] = useState<TimeFilter>("all");
  const [salesByTableFilter, setSalesByTableFilter] = useState<TimeFilter>("all");
  const [adjustmentsMonthlyFilter, setAdjustmentsMonthlyFilter] =
    useState<TimeFilter>("all");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sendingEmailSaleId, setSendingEmailSaleId] = useState<number | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(true);

  const withPeriodParam = useCallback((basePath: string, period: TimeFilter) => {
    return `${basePath}?period=${encodeURIComponent(period)}`;
  }, []);

  const loadSalesData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      setPurchasesLoading(true);
      const [
        salesResponse,
        productsResponse,
        categoriesResponse,
        waitersResponse,
        tablesResponse,
        adjustmentsMonthlyResponse,
        purchasesResponse,
      ] = await Promise.all([
        fetch(withPeriodParam("/api/sales", salesHistoryFilter), { cache: "no-store" }),
        fetch(withPeriodParam("/api/sales/summary/products", salesByProductFilter), {
          cache: "no-store",
        }),
        fetch(withPeriodParam("/api/sales/summary/categories", salesByCategoryFilter), {
          cache: "no-store",
        }),
        fetch(withPeriodParam("/api/sales/summary/waiters", salesByWaiterFilter), {
          cache: "no-store",
        }),
        fetch(withPeriodParam("/api/sales/summary/tables", salesByTableFilter), {
          cache: "no-store",
        }),
        fetch(
          withPeriodParam(
            "/api/sales/summary/adjustments/monthly",
            adjustmentsMonthlyFilter,
          ),
          { cache: "no-store" },
        ),
        fetch("/api/inventory/purchases", { cache: "no-store" }),
      ]);

      const [
        salesPayload,
        productsPayload,
        categoriesPayload,
        waitersPayload,
        tablesPayload,
        adjustmentsMonthlyPayload,
        purchasesPayload,
      ] = await Promise.all([
        safeJson(salesResponse),
        safeJson(productsResponse),
        safeJson(categoriesResponse),
        safeJson(waitersResponse),
        safeJson(tablesResponse),
        safeJson(adjustmentsMonthlyResponse),
        safeJson(purchasesResponse),
      ]);

      if (!salesResponse.ok) {
        throw new Error(
          (salesPayload as any)?.message || "No se pudo cargar el historial de ventas",
        );
      }
      if (!productsResponse.ok) {
        throw new Error(
          (productsPayload as any)?.message || "No se pudo cargar ventas por producto",
        );
      }
      if (!categoriesResponse.ok) {
        throw new Error(
          (categoriesPayload as any)?.message || "No se pudo cargar ventas por categoria",
        );
      }
      if (!waitersResponse.ok) {
        throw new Error(
          (waitersPayload as any)?.message || "No se pudo cargar ventas por mesero",
        );
      }
      if (!tablesResponse.ok) {
        throw new Error(
          (tablesPayload as any)?.message || "No se pudo cargar ventas por mesa",
        );
      }
      if (!adjustmentsMonthlyResponse.ok) {
        throw new Error(
          (adjustmentsMonthlyPayload as any)?.message ||
            "No se pudo cargar cortesias/descuentos por mes",
        );
      }
      if (purchasesResponse.ok && Array.isArray(purchasesPayload)) {
        setPurchases(purchasesPayload as PurchaseRecord[]);
      } else {
        setPurchases([]);
      }

      setSales(Array.isArray(salesPayload) ? (salesPayload as Sale[]) : []);
      setSalesByProduct(
        Array.isArray(productsPayload) ? (productsPayload as SalesByProduct[]) : [],
      );
      setSalesByCategory(
        Array.isArray(categoriesPayload) ? (categoriesPayload as SalesByCategory[]) : [],
      );
      setSalesByWaiter(
        Array.isArray(waitersPayload) ? (waitersPayload as SalesByWaiter[]) : [],
      );
      setSalesByTable(
        Array.isArray(tablesPayload) ? (tablesPayload as SalesByTable[]) : [],
      );
      setSalesAdjustmentsByMonth(
        Array.isArray(adjustmentsMonthlyPayload)
          ? (adjustmentsMonthlyPayload as SalesAdjustmentsByMonth[])
          : [],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar ventas";
      setErrorMessage(message);
      setPurchases([]);
      setSales([]);
      setSalesByProduct([]);
      setSalesByCategory([]);
      setSalesByWaiter([]);
      setSalesByTable([]);
      setSalesAdjustmentsByMonth([]);
    } finally {
      setLoading(false);
      setPurchasesLoading(false);
    }
  }, [
    adjustmentsMonthlyFilter,
    salesByCategoryFilter,
    salesByProductFilter,
    salesByTableFilter,
    salesByWaiterFilter,
    salesHistoryFilter,
    withPeriodParam,
  ]);

  useEffect(() => {
    loadSalesData();
  }, [loadSalesData]);

  const handleResendEmail = useCallback(
    async (sale: Sale) => {
      const suggestedEmail = sale.electronic_invoice_email_address ?? "";
      const emailInput = window.prompt("Correo destino para enviar la factura", suggestedEmail);
      const email = emailInput?.trim() ?? "";
      if (!email) return;

      setSendingEmailSaleId(sale.id);
      try {
        const response = await fetch(`/api/factus/sales/${sale.id}/send-email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const payload = await safeJson(response);
        if (!response.ok) {
          throw new Error(
            (payload as any)?.message ||
              (payload as any)?.detail ||
              "No se pudo reenviar el correo",
          );
        }
        await loadSalesData();
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo reenviar el correo";
        window.alert(message);
      } finally {
        setSendingEmailSaleId(null);
      }
    },
    [loadSalesData],
  );

  const totalSalesValue = useMemo(
    () => sales.reduce((acc, sale) => acc + safeNumber(sale.total), 0),
    [sales],
  );
  const totalSalesCount = sales.length;
  const totalItemsSold = useMemo(
    () =>
      sales.reduce(
        (acc, sale) =>
          acc +
          sale.items.reduce((inner, item) => inner + safeNumber(item.quantity), 0),
        0,
      ),
    [sales],
  );
  const totalCourtesyApplied = useMemo(
    () => sales.reduce((acc, sale) => acc + safeNumber(sale.courtesy_count), 0),
    [sales],
  );
  const totalDiscountApplied = useMemo(
    () => sales.reduce((acc, sale) => acc + safeNumber(sale.discount_count), 0),
    [sales],
  );
  const salesBreakdown = useMemo(() => aggregateSalesBreakdown(sales), [sales]);
  const purchasesInSalesPeriod = useMemo(
    () => filterPurchasesByTimeFilter(purchases, salesHistoryFilter),
    [purchases, salesHistoryFilter],
  );
  const totalPurchasesInSalesPeriod = useMemo(
    () => sumPurchaseTotalCost(purchasesInSalesPeriod),
    [purchasesInSalesPeriod],
  );
  const salesHistoryTotalPages = Math.max(
    1,
    Math.ceil(sales.length / SALES_HISTORY_PAGE_SIZE),
  );
  const salesByProductTotalPages = Math.max(
    1,
    Math.ceil(salesByProduct.length / SALES_BY_PRODUCT_PAGE_SIZE),
  );
  const salesByCategoryTotalPages = Math.max(
    1,
    Math.ceil(salesByCategory.length / SALES_BY_CATEGORY_PAGE_SIZE),
  );
  const salesByWaiterTotalPages = Math.max(
    1,
    Math.ceil(salesByWaiter.length / SALES_BY_WAITER_PAGE_SIZE),
  );
  const salesByTableTotalPages = Math.max(
    1,
    Math.ceil(salesByTable.length / SALES_BY_TABLE_PAGE_SIZE),
  );
  const adjustmentsMonthlyTotalPages = Math.max(
    1,
    Math.ceil(salesAdjustmentsByMonth.length / ADJUSTMENTS_MONTHLY_PAGE_SIZE),
  );

  useEffect(() => {
    setSalesHistoryPage((prev) => Math.min(prev, salesHistoryTotalPages));
  }, [salesHistoryTotalPages]);

  useEffect(() => {
    setSalesByProductPage((prev) => Math.min(prev, salesByProductTotalPages));
  }, [salesByProductTotalPages]);

  useEffect(() => {
    setSalesByCategoryPage((prev) => Math.min(prev, salesByCategoryTotalPages));
  }, [salesByCategoryTotalPages]);

  useEffect(() => {
    setSalesByWaiterPage((prev) => Math.min(prev, salesByWaiterTotalPages));
  }, [salesByWaiterTotalPages]);

  useEffect(() => {
    setSalesByTablePage((prev) => Math.min(prev, salesByTableTotalPages));
  }, [salesByTableTotalPages]);

  useEffect(() => {
    setAdjustmentsMonthlyPage((prev) => Math.min(prev, adjustmentsMonthlyTotalPages));
  }, [adjustmentsMonthlyTotalPages]);

  useEffect(() => {
    setSalesHistoryPage(1);
  }, [salesHistoryFilter]);

  useEffect(() => {
    setSalesByProductPage(1);
  }, [salesByProductFilter]);

  useEffect(() => {
    setSalesByCategoryPage(1);
  }, [salesByCategoryFilter]);

  useEffect(() => {
    setSalesByWaiterPage(1);
  }, [salesByWaiterFilter]);

  useEffect(() => {
    setSalesByTablePage(1);
  }, [salesByTableFilter]);

  useEffect(() => {
    setAdjustmentsMonthlyPage(1);
  }, [adjustmentsMonthlyFilter]);

  const paginatedSalesHistory = useMemo(() => {
    const start = (salesHistoryPage - 1) * SALES_HISTORY_PAGE_SIZE;
    return sales.slice(start, start + SALES_HISTORY_PAGE_SIZE);
  }, [sales, salesHistoryPage]);

  const paginatedSalesByProduct = useMemo(() => {
    const start = (salesByProductPage - 1) * SALES_BY_PRODUCT_PAGE_SIZE;
    return salesByProduct.slice(start, start + SALES_BY_PRODUCT_PAGE_SIZE);
  }, [salesByProduct, salesByProductPage]);

  const paginatedSalesByCategory = useMemo(() => {
    const start = (salesByCategoryPage - 1) * SALES_BY_CATEGORY_PAGE_SIZE;
    return salesByCategory.slice(start, start + SALES_BY_CATEGORY_PAGE_SIZE);
  }, [salesByCategory, salesByCategoryPage]);

  const paginatedSalesByWaiter = useMemo(() => {
    const start = (salesByWaiterPage - 1) * SALES_BY_WAITER_PAGE_SIZE;
    return salesByWaiter.slice(start, start + SALES_BY_WAITER_PAGE_SIZE);
  }, [salesByWaiter, salesByWaiterPage]);

  const paginatedSalesByTable = useMemo(() => {
    const start = (salesByTablePage - 1) * SALES_BY_TABLE_PAGE_SIZE;
    return salesByTable.slice(start, start + SALES_BY_TABLE_PAGE_SIZE);
  }, [salesByTable, salesByTablePage]);

  const paginatedAdjustmentsByMonth = useMemo(() => {
    const start = (adjustmentsMonthlyPage - 1) * ADJUSTMENTS_MONTHLY_PAGE_SIZE;
    return salesAdjustmentsByMonth.slice(start, start + ADJUSTMENTS_MONTHLY_PAGE_SIZE);
  }, [salesAdjustmentsByMonth, adjustmentsMonthlyPage]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Link
          href="/sales/report"
          className="w-full rounded-md bg-secondary px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-secondary/90 sm:w-auto sm:py-2"
        >
          Informe de ventas
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-5">
        <div className="rounded-sm border border-stroke bg-white px-5 py-4 shadow-default transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-sm text-body">Ventas registradas</p>
          <p className="mt-2 text-2xl font-semibold text-black dark:text-white">
            {totalSalesCount}
          </p>
        </div>
        <div className="rounded-sm border border-stroke bg-white px-5 py-4 shadow-default transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-sm text-body">Total facturado</p>
          <p className="mt-2 text-2xl font-semibold text-black dark:text-white">
            {formatMoney(totalSalesValue)}
          </p>
        </div>
        <div className="rounded-sm border border-stroke bg-white px-5 py-4 shadow-default transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-sm text-body">Items vendidos</p>
          <p className="mt-2 text-2xl font-semibold text-black dark:text-white">
            {formatQty(totalItemsSold)}
          </p>
        </div>
        <div className="rounded-sm border border-stroke bg-white px-5 py-4 shadow-default transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-sm text-body">Cortesías aplicadas</p>
          <p className="mt-2 text-2xl font-semibold text-black dark:text-white">
            {formatCount(totalCourtesyApplied)}
          </p>
        </div>
        <div className="rounded-sm border border-stroke bg-white px-5 py-4 shadow-default transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-sm text-body">Descuentos aplicados</p>
          <p className="mt-2 text-2xl font-semibold text-black dark:text-white">
            {formatCount(totalDiscountApplied)}
          </p>
        </div>
      </div>

      <SalesBreakdownPanel
        title="Total facturado y desglose (métricas de ventas)"
        subtitle="Alineado al filtro de tiempo del historial de ventas. Las compras se filtran con el mismo periodo móvil (7 / 30 / 90 / 365 días) o sin recorte en “Mostrar todo”."
        loading={loading}
        breakdown={salesBreakdown}
        purchasesTotal={totalPurchasesInSalesPeriod}
        formatMoney={(v) => formatMoney(v)}
      />

      <PurchasesMetricsPanel purchases={purchases} loading={purchasesLoading} />

      <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-dark-3 dark:bg-gray-dark">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-black dark:text-white">Historial de ventas</h3>
            <p className="text-sm text-body">
              Pedidos pagados registrados desde toma de pedidos.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <TimeFilterSelect value={salesHistoryFilter} onChange={setSalesHistoryFilter} />
            <button
              type="button"
              onClick={loadSalesData}
              className="rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-black transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              Actualizar
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-body">Cargando ventas...</p>
        ) : errorMessage ? (
          <p className="text-sm text-danger">{errorMessage}</p>
        ) : sales.length === 0 ? (
          <p className="text-sm text-body">No hay ventas registradas.</p>
        ) : (
          <TableScroll className="-mx-2 sm:mx-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venta</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Medio de pago</TableHead>
                <TableHead>Factura electronica</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Cortesías</TableHead>
                <TableHead>Descuentos</TableHead>
                <TableHead>Monto descuento</TableHead>
                <TableHead>Subtotal</TableHead>
                <TableHead>INC</TableHead>
                <TableHead>Servicio</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedSalesHistory.map((sale) => {
                const itemsCount = sale.items.reduce(
                  (acc, item) => acc + safeNumber(item.quantity),
                  0,
                );
                return (
                  <TableRow key={sale.id}>
                    <TableCell className="font-medium text-black dark:text-white">
                      #{sale.id}
                    </TableCell>
                    <TableCell>#{sale.order_id}</TableCell>
                    <TableCell>{formatDate(sale.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-black dark:text-white">
                      {salePaymentMethodLabel(sale.payment_method ?? undefined)}
                    </TableCell>
                    <TableCell>
                      {sale.electronic_invoice_status === "issued" ? (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-success">
                            Emitida{sale.electronic_invoice_number ? ` #${sale.electronic_invoice_number}` : ""}
                          </p>
                          {sale.electronic_invoice_cufe ? (
                            <p className="max-w-[220px] truncate text-[11px] text-body" title={sale.electronic_invoice_cufe}>
                              CUFE: {sale.electronic_invoice_cufe}
                            </p>
                          ) : null}
                          {sale.electronic_invoice_qr_url ? (
                            <a
                              href={sale.electronic_invoice_qr_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Ver FE
                            </a>
                          ) : null}
                          <a
                            href={`/api/factus/sales/${sale.id}/document`}
                            target="_blank"
                            rel="noreferrer"
                            className="block text-xs font-medium text-primary hover:underline"
                          >
                            Descargar PDF
                          </a>
                          {sale.electronic_invoice_email_status === "sent" ? (
                            <p className="max-w-[220px] truncate text-[11px] text-success" title={sale.electronic_invoice_email_address ?? ""}>
                              Correo enviado{sale.electronic_invoice_email_address ? `: ${sale.electronic_invoice_email_address}` : ""}
                            </p>
                          ) : sale.electronic_invoice_email_status === "failed" ? (
                            <p
                              className="max-w-[220px] truncate text-[11px] text-danger"
                              title={sale.electronic_invoice_email_error ?? ""}
                            >
                              Correo fallido
                            </p>
                          ) : sale.electronic_invoice_email_status === "requested" ? (
                            <p className="max-w-[220px] truncate text-[11px] text-body" title={sale.electronic_invoice_email_address ?? ""}>
                              Correo solicitado a Factus{sale.electronic_invoice_email_address ? `: ${sale.electronic_invoice_email_address}` : ""}
                            </p>
                          ) : (
                            <p className="text-[11px] text-body">Correo no solicitado</p>
                          )}
                          {sale.electronic_invoice_environment === "sandbox" ? (
                            <p className="text-[11px] text-body">
                              Reenvio manual no disponible en sandbox.
                            </p>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleResendEmail(sale)}
                              disabled={sendingEmailSaleId === sale.id}
                              className="rounded border border-stroke px-2 py-1 text-[11px] font-medium text-black hover:bg-gray-2 disabled:opacity-60 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                            >
                              {sendingEmailSaleId === sale.id ? "Enviando..." : "Reenviar correo"}
                            </button>
                          )}
                        </div>
                      ) : sale.electronic_invoice_status === "failed" ? (
                        <span className="text-xs font-medium text-danger">Fallida</span>
                      ) : sale.electronic_invoice_status === "pending" ? (
                        <span className="text-xs font-medium text-warning">Pendiente</span>
                      ) : (
                        <span className="text-xs text-body">No emitida</span>
                      )}
                    </TableCell>
                    <TableCell>{formatQty(itemsCount)}</TableCell>
                    <TableCell>{formatCount(sale.courtesy_count)}</TableCell>
                    <TableCell>{formatCount(sale.discount_count)}</TableCell>
                    <TableCell>{formatMoney(sale.discount_total)}</TableCell>
                    <TableCell>{formatMoney(sale.subtotal)}</TableCell>
                    <TableCell>{formatMoney(sale.tax_total)}</TableCell>
                    <TableCell>{formatMoney(sale.service_total)}</TableCell>
                    <TableCell className="font-semibold text-black dark:text-white">
                      {formatMoney(sale.total)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </TableScroll>
        )}
        {!loading && !errorMessage ? (
          <PaginationControls
            page={salesHistoryPage}
            totalPages={salesHistoryTotalPages}
            onPageChange={(nextPage) =>
              setSalesHistoryPage(Math.max(1, Math.min(nextPage, salesHistoryTotalPages)))
            }
          />
        ) : null}
      </div>

      <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-dark-3 dark:bg-gray-dark">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xl font-semibold text-black dark:text-white">
              Ventas por mesa
            </h3>
            <p className="text-sm text-body">Acumulado por mesa (incluye mesas eliminadas).</p>
          </div>
          <TimeFilterSelect value={salesByTableFilter} onChange={setSalesByTableFilter} />
        </div>
        {loading ? (
          <p className="text-sm text-body">Cargando resumen...</p>
        ) : salesByTable.length === 0 ? (
          <p className="text-sm text-body">No hay datos para mostrar.</p>
        ) : (
          <TableScroll className="-mx-2 sm:mx-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mesa</TableHead>
                <TableHead>Ventas</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedSalesByTable.map((row) => {
                const baseName = row.name ?? (row.table_id ? `Mesa ${row.table_id}` : "Mesa eliminada");
                const label =
                  row.is_active === false ? `${baseName} (eliminada)` : baseName;
                return (
                  <TableRow key={row.table_id ?? label}>
                    <TableCell className="font-medium text-black dark:text-white">
                      {label}
                    </TableCell>
                    <TableCell>{formatQty(row.quantity)}</TableCell>
                    <TableCell className="font-semibold text-black dark:text-white">
                      {formatMoney(row.total)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </TableScroll>
        )}
        {!loading ? (
          <PaginationControls
            page={salesByTablePage}
            totalPages={salesByTableTotalPages}
            onPageChange={(nextPage) =>
              setSalesByTablePage(Math.max(1, Math.min(nextPage, salesByTableTotalPages)))
            }
          />
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-dark-3 dark:bg-gray-dark">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xl font-semibold text-black dark:text-white">
                Ventas por producto
              </h3>
              <p className="text-sm text-body">Acumulado por item del menu.</p>
            </div>
            <TimeFilterSelect value={salesByProductFilter} onChange={setSalesByProductFilter} />
          </div>
          {loading ? (
            <p className="text-sm text-body">Cargando resumen...</p>
          ) : salesByProduct.length === 0 ? (
            <p className="text-sm text-body">No hay datos para mostrar.</p>
          ) : (
            <TableScroll className="-mx-2 sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow className="border-none bg-[#F7F9FC] dark:bg-dark-2">
                  <TableHead>Producto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSalesByProduct.map((row) => (
                  <TableRow key={row.menu_item_id}>
                    <TableCell className="font-medium text-black dark:text-white">
                      {row.name}
                    </TableCell>
                    <TableCell className="text-black dark:text-white">{row.category}</TableCell>
                    <TableCell className="text-black dark:text-white">{formatQty(row.quantity)}</TableCell>
                    <TableCell className="font-semibold text-black dark:text-white">
                      {formatMoney(row.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableScroll>
          )}
          {!loading ? (
            <PaginationControls
              page={salesByProductPage}
              totalPages={salesByProductTotalPages}
              onPageChange={(nextPage) =>
                setSalesByProductPage(Math.max(1, Math.min(nextPage, salesByProductTotalPages)))
              }
            />
          ) : null}
        </div>

        <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-dark-3 dark:bg-gray-dark">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xl font-semibold text-black dark:text-white">
                Ventas por categoria
              </h3>
              <p className="text-sm text-body">Acumulado por categoria del menu.</p>
            </div>
            <TimeFilterSelect value={salesByCategoryFilter} onChange={setSalesByCategoryFilter} />
          </div>
          {loading ? (
            <p className="text-sm text-body">Cargando resumen...</p>
          ) : salesByCategory.length === 0 ? (
            <p className="text-sm text-body">No hay datos para mostrar.</p>
          ) : (
            <TableScroll className="-mx-2 sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSalesByCategory.map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium text-black dark:text-white">
                      {row.category}
                    </TableCell>
                    <TableCell>{formatQty(row.quantity)}</TableCell>
                    <TableCell className="font-semibold text-black dark:text-white">
                      {formatMoney(row.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableScroll>
          )}
          {!loading ? (
            <PaginationControls
              page={salesByCategoryPage}
              totalPages={salesByCategoryTotalPages}
              onPageChange={(nextPage) =>
                setSalesByCategoryPage(Math.max(1, Math.min(nextPage, salesByCategoryTotalPages)))
              }
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-dark-3 dark:bg-gray-dark">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xl font-semibold text-black dark:text-white">
                Ventas por mesero
              </h3>
              <p className="text-sm text-body">Acumulado por mesero asignado.</p>
            </div>
            <TimeFilterSelect value={salesByWaiterFilter} onChange={setSalesByWaiterFilter} />
          </div>
          {loading ? (
            <p className="text-sm text-body">Cargando resumen...</p>
          ) : salesByWaiter.length === 0 ? (
            <p className="text-sm text-body">No hay datos para mostrar.</p>
          ) : (
            <TableScroll className="-mx-2 sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mesero</TableHead>
                  <TableHead>Ventas</TableHead>
                  <TableHead>Propinas</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSalesByWaiter.map((row) => (
                  <TableRow key={row.waiter_id ?? row.name}>
                    <TableCell className="font-medium text-black dark:text-white">
                      {row.name}
                    </TableCell>
                    <TableCell>{formatQty(row.quantity)}</TableCell>
                    <TableCell>{formatMoney(row.service_total)}</TableCell>
                    <TableCell className="font-semibold text-black dark:text-white">
                      {formatMoney(row.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableScroll>
          )}
          {!loading ? (
            <PaginationControls
              page={salesByWaiterPage}
              totalPages={salesByWaiterTotalPages}
              onPageChange={(nextPage) =>
                setSalesByWaiterPage(Math.max(1, Math.min(nextPage, salesByWaiterTotalPages)))
              }
            />
          ) : null}
        </div>

        <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-dark-3 dark:bg-gray-dark">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xl font-semibold text-black dark:text-white">
                Cortesías y descuentos por mes
              </h3>
              <p className="text-sm text-body">
                Cantidad de ajustes aplicados agrupados por mes.
              </p>
            </div>
            <TimeFilterSelect
              value={adjustmentsMonthlyFilter}
              onChange={setAdjustmentsMonthlyFilter}
            />
          </div>
          {loading ? (
            <p className="text-sm text-body">Cargando resumen...</p>
          ) : salesAdjustmentsByMonth.length === 0 ? (
            <p className="text-sm text-body">No hay datos para mostrar.</p>
          ) : (
            <TableScroll className="-mx-2 sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead>Cortesías</TableHead>
                  <TableHead>Descuentos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedAdjustmentsByMonth.map((row) => (
                  <TableRow key={`${row.year}-${row.month}`}>
                    <TableCell className="font-medium text-black dark:text-white">
                      {formatMonthLabel(row.year, row.month)}
                    </TableCell>
                    <TableCell>{formatCount(row.courtesy_count)}</TableCell>
                    <TableCell>{formatCount(row.discount_count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableScroll>
          )}
          {!loading ? (
            <PaginationControls
              page={adjustmentsMonthlyPage}
              totalPages={adjustmentsMonthlyTotalPages}
              onPageChange={(nextPage) =>
                setAdjustmentsMonthlyPage(
                  Math.max(1, Math.min(nextPage, adjustmentsMonthlyTotalPages)),
                )
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
