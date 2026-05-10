"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import jsPDF from "jspdf";
import { useCallback, useEffect, useMemo, useState } from "react";

dayjs.extend(utc);
dayjs.extend(timezone);

const COLOMBIA_TZ = "America/Bogota";
const LS_PREFIX = "girona.cashClosing.";

type SaleRow = {
  id: number;
  total: number | string;
  subtotal: number | string;
  tax_total: number | string;
  service_total: number | string;
  courtesy_total: number | string;
  created_at: string;
  payment_method?: string | null;
};

type PurchaseRow = {
  id: number;
  total_cost: number | string;
  created_at: string;
  items?: unknown[];
};

function safeNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(safeNumber(value));
}

function todayYmd() {
  return dayjs().tz(COLOMBIA_TZ).format("YYYY-MM-DD");
}

function purchaseOnDate(p: PurchaseRow, ymd: string) {
  const t = p.created_at;
  if (!t) return false;
  return dayjs(t).tz(COLOMBIA_TZ).format("YYYY-MM-DD") === ymd;
}

type Draft = {
  opening: string;
  cashIn: string;
  cardCreditIn: string;
  cardDebitIn: string;
  transferIn: string;
  counted: string;
  note: string;
};

const EMPTY_DRAFT: Draft = {
  opening: "",
  cashIn: "",
  cardCreditIn: "",
  cardDebitIn: "",
  transferIn: "",
  counted: "",
  note: "",
};

function loadDraft(ymd: string): Draft {
  if (typeof window === "undefined") {
    return { ...EMPTY_DRAFT };
  }
  try {
    const raw = window.localStorage.getItem(`${LS_PREFIX}${ymd}`);
    if (!raw) return { ...EMPTY_DRAFT };
    const p = JSON.parse(raw) as Partial<Draft>;
    return {
      opening: String(p.opening ?? ""),
      cashIn: String(p.cashIn ?? ""),
      cardCreditIn: String(p.cardCreditIn ?? ""),
      cardDebitIn: String(p.cardDebitIn ?? ""),
      transferIn: String(p.transferIn ?? ""),
      counted: String(p.counted ?? ""),
      note: String(p.note ?? ""),
    };
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

function saveDraft(ymd: string, d: Draft) {
  try {
    window.localStorage.setItem(`${LS_PREFIX}${ymd}`, JSON.stringify(d));
  } catch {
    // ignore
  }
}

function paymentLabel(code: string | null | undefined) {
  if (!code) return "—";
  const c = code.toLowerCase();
  const map: Record<string, string> = {
    efectivo: "Efectivo",
    datofono: "Datáfono",
    qr: "QR",
    nequi: "Nequi",
    tarjeta: "Tarjeta",
    tarjeta_credito: "Tarjeta crédito",
    tarjeta_debito: "Tarjeta débito",
    transferencia: "Transferencia",
    billetera: "Billetera",
    otro: "Otro",
  };
  return map[c] ?? code;
}

/** jsPDF default font is Latin-1; evita acentos rotos. */
function pdfText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function ensurePageSpace(doc: jsPDF, y: number, minBottom: number, margin: number) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - minBottom) {
    doc.addPage();
    return margin + 6;
  }
  return y;
}

type CashClosingMetrics = {
  n: number;
  totalVentas: number;
  totalPropinas: number;
  totalCortesias: number;
  egresosCompras: number;
  totalDatofono: number;
  totalQr: number;
  totalNequi: number;
};

type CashClosingPdfInput = {
  dateYmd: string;
  metrics: CashClosingMetrics;
  draft: Draft;
  esperadoEfectivo: number;
  diferencia: number;
  sales: SaleRow[];
  purchasesDay: PurchaseRow[];
};

function buildCashClosingPdf(input: CashClosingPdfInput) {
  const {
    dateYmd,
    metrics,
    draft,
    esperadoEfectivo,
    diferencia,
    sales,
    purchasesDay,
  } = input;

  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = 16;

  const fechaLabel = dayjs(dateYmd).tz(COLOMBIA_TZ).format("DD/MM/YYYY");

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(pdfText("Cierre de caja"), margin, y);
  y += 9;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(pdfText(`Fecha de cierre: ${fechaLabel}`), margin, y);
  y += 5;
  doc.text(
    pdfText(
      `Generado: ${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}`,
    ),
    margin,
    y,
  );
  y += 10;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(pdfText("Resumen del dia (sistema)"), margin, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const linesResumen = [
    `Ventas: ${formatMoney(metrics.totalVentas)} (${metrics.n} transaccion(es))`,
    `Propinas / servicio: ${formatMoney(metrics.totalPropinas)}`,
    `Datáfono (incl. ventas históricas con tarjeta): ${formatMoney(metrics.totalDatofono)}`,
    `QR (incl. transferencias históricas): ${formatMoney(metrics.totalQr)}`,
    `Nequi (incl. billetera histórica): ${formatMoney(metrics.totalNequi)}`,
    `Cortesias: ${formatMoney(metrics.totalCortesias)}`,
    `Compras / egresos: ${formatMoney(metrics.egresosCompras)} (${purchasesDay.length} registro(s))`,
    `Ingresos - egresos (referencia): ${formatMoney(metrics.totalVentas - metrics.egresosCompras)}`,
  ];
  for (const line of linesResumen) {
    y = ensurePageSpace(doc, y, 24, margin);
    doc.text(pdfText(line), margin, y);
    y += 5;
  }

  y += 4;
  y = ensurePageSpace(doc, y, 40, margin);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(pdfText("Arqueo y registros manuales"), margin, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const manual = [
    `Fondo de apertura: ${formatMoney(draft.opening)}`,
    `Ingresos en efectivo (estimado): ${formatMoney(draft.cashIn)}`,
    `Ingresos tarjeta credito (manual): ${formatMoney(draft.cardCreditIn)}`,
    `Ingresos tarjeta debito (manual): ${formatMoney(draft.cardDebitIn)}`,
    `Ingresos transferencia (manual): ${formatMoney(draft.transferIn)}`,
    `Efectivo contado al cierre: ${formatMoney(draft.counted)}`,
    `Efectivo esperado (apertura + efectivo estimado): ${formatMoney(esperadoEfectivo)}`,
    `Diferencia (contado - esperado): ${formatMoney(diferencia)}`,
  ];
  for (const line of manual) {
    y = ensurePageSpace(doc, y, 24, margin);
    doc.text(pdfText(line), margin, y);
    y += 5;
  }

  const note = (draft.note ?? "").trim();
  if (note) {
    y += 3;
    y = ensurePageSpace(doc, y, 32, margin);
    doc.setFont("helvetica", "bold");
    doc.text(pdfText("Notas del cierre"), margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(pdfText(note), pageW - margin * 2);
    for (const piece of wrapped) {
      y = ensurePageSpace(doc, y, 20, margin);
      doc.text(piece, margin, y);
      y += 4;
    }
  }

  y += 6;
  y = ensurePageSpace(doc, y, 30, margin);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(pdfText("Detalle de ventas del dia"), margin, y);
  y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  if (sales.length === 0) {
    doc.text(pdfText("Sin ventas para esta fecha."), margin, y);
    y += 6;
  } else {
    for (const s of sales) {
      y = ensurePageSpace(doc, y, 14, margin);
      const hora = dayjs(s.created_at).tz(COLOMBIA_TZ).format("DD/MM/YYYY HH:mm");
      const medio = paymentLabel(s.payment_method);
      const row = `#${s.id}  ${hora}  ${medio}  ${formatMoney(s.total)}`;
      const parts = doc.splitTextToSize(pdfText(row), pageW - margin * 2);
      for (const piece of parts) {
        doc.text(piece, margin, y);
        y += 4;
        y = ensurePageSpace(doc, y, 14, margin);
      }
      y += 1;
    }
  }

  if (purchasesDay.length > 0) {
    y += 4;
    y = ensurePageSpace(doc, y, 28, margin);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(pdfText("Compras registradas el dia"), margin, y);
    y += 7;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    for (const p of purchasesDay) {
      y = ensurePageSpace(doc, y, 12, margin);
      const hora = p.created_at
        ? dayjs(p.created_at).tz(COLOMBIA_TZ).format("DD/MM/YYYY HH:mm")
        : "—";
      doc.text(
        pdfText(`Compra #${p.id}  ${hora}  ${formatMoney(p.total_cost)}`),
        margin,
        y,
      );
      y += 4;
    }
  }

  doc.save(pdfText(`cierre-caja-${dateYmd}.pdf`));
}

export default function CashClosing() {
  const [dateInput, setDateInput] = useState(todayYmd);
  const [dateYmd, setDateYmd] = useState(todayYmd);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [purchasesDay, setPurchasesDay] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });

  useEffect(() => {
    setDraft(loadDraft(dateYmd));
  }, [dateYmd]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [salesRes, purRes] = await Promise.all([
        fetch(`/api/sales?on_date=${encodeURIComponent(dateYmd)}`, { cache: "no-store" }),
        fetch("/api/inventory/purchases", { cache: "no-store" }),
      ]);
      const [salesJson, purJson] = await Promise.all([salesRes.json().catch(() => null), purRes.json().catch(() => null)]);
      if (!salesRes.ok) {
        throw new Error(
          (salesJson as { message?: string })?.message || "No se pudieron cargar las ventas del día",
        );
      }
      const s = Array.isArray(salesJson) ? (salesJson as SaleRow[]) : [];
      setSales(s);
      const allPur = purRes.ok && Array.isArray(purJson) ? (purJson as PurchaseRow[]) : [];
      setPurchasesDay(allPur.filter((p) => purchaseOnDate(p, dateYmd)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar datos");
      setSales([]);
      setPurchasesDay([]);
    } finally {
      setLoading(false);
    }
  }, [dateYmd]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const metrics = useMemo(() => {
    const n = sales.length;
    const totalVentas = sales.reduce((a, s) => a + safeNumber(s.total), 0);
    const totalPropinas = sales.reduce((a, s) => a + safeNumber(s.service_total), 0);
    const totalCortesias = sales.reduce((a, s) => a + safeNumber(s.courtesy_total), 0);
    const egresosCompras = purchasesDay.reduce((a, p) => a + safeNumber(p.total_cost), 0);
    let totalDatofono = 0;
    let totalQr = 0;
    let totalNequi = 0;
    for (const s of sales) {
      const code = (s.payment_method ?? "").toLowerCase();
      const t = safeNumber(s.total);
      if (
        code === "datofono" ||
        code === "tarjeta_credito" ||
        code === "tarjeta_debito" ||
        code === "tarjeta"
      ) {
        totalDatofono += t;
      } else if (code === "qr" || code === "transferencia") {
        totalQr += t;
      } else if (code === "nequi" || code === "billetera") {
        totalNequi += t;
      }
    }
    return {
      n,
      totalVentas,
      totalPropinas,
      totalCortesias,
      egresosCompras,
      totalDatofono,
      totalQr,
      totalNequi,
    };
  }, [sales, purchasesDay]);

  const opening = safeNumber(draft.opening);
  const cashIn = safeNumber(draft.cashIn);
  const counted = safeNumber(draft.counted);
  const esperadoEfectivo = opening + cashIn;
  const diferencia = counted - esperadoEfectivo;

  function updateDraft(partial: Partial<Draft>) {
    setDraft((prev) => {
      const next = { ...prev, ...partial };
      saveDraft(dateYmd, next);
      return next;
    });
  }

  function handleCloseCashRegister() {
    const label = dayjs(dateYmd).tz(COLOMBIA_TZ).format("DD/MM/YYYY");
    const ok = window.confirm(
      `¿Confirmar cierre de caja para ${label}? Se descargará el PDF del cierre como constancia.`,
    );
    if (!ok) return;
    buildCashClosingPdf({
      dateYmd,
      metrics,
      draft,
      esperadoEfectivo,
      diferencia,
      sales,
      purchasesDay,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-dark dark:text-white">Cierre de caja</h2>
          <p className="mt-1 text-sm text-body">
            Referencia con ventas y compras del día (Colombia). Tarjeta crédito y débito se separan según el
            medio guardado al cerrar el pedido; transferencias aparte. El efectivo físico se arquea abajo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex flex-col text-xs font-medium text-dark-6 dark:text-dark-6">
            Fecha
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className="mt-1 rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (dateInput === dateYmd) {
                void loadData();
              } else {
                setDateYmd(dateInput);
              }
            }}
            className="mt-5 rounded-md bg-secondary px-4 py-2 text-sm font-medium text-white hover:bg-secondary/90"
          >
            Filtrar
          </button>
          <button
            type="button"
            onClick={() => {
              void loadData();
            }}
            className="mt-5 rounded-md border border-stroke px-4 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
          >
            Actualizar
          </button>
          <button
            type="button"
            onClick={() =>
              buildCashClosingPdf({
                dateYmd,
                metrics,
                draft,
                esperadoEfectivo,
                diferencia,
                sales,
                purchasesDay,
              })
            }
            className="mt-5 rounded-md border border-stroke bg-white px-4 py-2 text-sm font-medium text-dark shadow-sm hover:bg-gray-2 dark:border-dark-3 dark:bg-gray-dark dark:text-white dark:hover:bg-dark-2"
          >
            Descargar PDF del cierre
          </button>
          <button
            type="button"
            onClick={handleCloseCashRegister}
            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Cerrar Caja
          </button>
          <Link
            href="/sales"
            className="mt-5 rounded-md border border-primary bg-transparent px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
          >
            Ir a ventas
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-red">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div className="rounded-lg border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Ventas (día)</p>
          <p className="mt-1 text-2xl font-semibold text-dark dark:text-white">{formatMoney(metrics.totalVentas)}</p>
          <p className="text-xs text-body-color dark:text-dark-6">{metrics.n} transacción(es) registrada(s)</p>
        </div>
        <div className="rounded-lg border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Propinas / servicio</p>
          <p className="mt-1 text-2xl font-semibold text-dark dark:text-white">{formatMoney(metrics.totalPropinas)}</p>
        </div>
        <div className="rounded-lg border border-stroke border-l-4 border-l-sky-500 bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Datáfono (día)</p>
          <p className="mt-1 text-2xl font-semibold text-dark dark:text-white">
            {formatMoney(metrics.totalDatofono)}
          </p>
          <p className="text-xs text-body-color dark:text-dark-6">Incluye ventas con tarjeta (histórico)</p>
        </div>
        <div className="rounded-lg border border-stroke border-l-4 border-l-teal-500 bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">QR (día)</p>
          <p className="mt-1 text-2xl font-semibold text-dark dark:text-white">
            {formatMoney(metrics.totalQr)}
          </p>
          <p className="text-xs text-body-color dark:text-dark-6">Incluye transferencias (histórico)</p>
        </div>
        <div className="rounded-lg border border-stroke border-l-4 border-l-violet-500 bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Nequi (día)</p>
          <p className="mt-1 text-2xl font-semibold text-dark dark:text-white">
            {formatMoney(metrics.totalNequi)}
          </p>
          <p className="text-xs text-body-color dark:text-dark-6">Incluye billetera (histórico)</p>
        </div>
        <div className="rounded-lg border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Cortesías (monto)</p>
          <p className="mt-1 text-2xl font-semibold text-dark dark:text-white">{formatMoney(metrics.totalCortesias)}</p>
        </div>
        <div className="rounded-lg border border-stroke border-l-4 border-l-secondary bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <p className="text-xs font-medium uppercase text-body-color dark:text-dark-6">Compras / egresos (día)</p>
          <p className="mt-1 text-2xl font-semibold text-dark dark:text-white">{formatMoney(metrics.egresosCompras)}</p>
          <p className="text-xs text-body-color dark:text-dark-6">
            {purchasesDay.length} registro(s) de compra
          </p>
        </div>
        <div className="rounded-lg border border-stroke bg-primary/5 p-4 dark:border-dark-3">
          <p className="text-xs font-medium uppercase text-primary">Ingresos − egresos (día, referencia)</p>
          <p className="mt-1 text-2xl font-semibold text-dark dark:text-white">
            {formatMoney(metrics.totalVentas - metrics.egresosCompras)}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
        <h3 className="text-lg font-semibold text-dark dark:text-white">Arqueo de efectivo (manual)</h3>
        <p className="mb-4 text-sm text-body">
          Complete solo lo que aplica. Los importes se guardan en este navegador para la fecha elegida.
        </p>
        <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
          <label className="text-sm text-dark dark:text-white">
            Fondo de apertura
            <input
              value={draft.opening}
              onChange={(e) => updateDraft({ opening: e.target.value })}
              inputMode="decimal"
              placeholder="0"
              className="mt-1 w-full rounded-md border border-stroke bg-white px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            />
          </label>
          <label className="text-sm text-dark dark:text-white">
            Ingresos en efectivo (estimado)
            <input
              value={draft.cashIn}
              onChange={(e) => updateDraft({ cashIn: e.target.value })}
              inputMode="decimal"
              placeholder="Opcional: solo efectivo"
              className="mt-1 w-full rounded-md border border-stroke bg-white px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            />
          </label>
          <label className="text-sm text-dark dark:text-white sm:col-span-2 md:col-span-1">
            Ingresos en tarjeta crédito (manual)
            <input
              value={draft.cardCreditIn}
              onChange={(e) => updateDraft({ cardCreditIn: e.target.value })}
              inputMode="decimal"
              placeholder="0"
              className="mt-1 w-full rounded-md border border-stroke bg-white px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            />
          </label>
          <label className="text-sm text-dark dark:text-white sm:col-span-2 md:col-span-1">
            Ingresos en tarjeta débito (manual)
            <input
              value={draft.cardDebitIn}
              onChange={(e) => updateDraft({ cardDebitIn: e.target.value })}
              inputMode="decimal"
              placeholder="0"
              className="mt-1 w-full rounded-md border border-stroke bg-white px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            />
          </label>
          <label className="text-sm text-dark dark:text-white sm:col-span-2">
            Ingresos en transferencia (manual)
            <input
              value={draft.transferIn}
              onChange={(e) => updateDraft({ transferIn: e.target.value })}
              inputMode="decimal"
              placeholder="0"
              className="mt-1 w-full rounded-md border border-stroke bg-white px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            />
          </label>
          <label className="text-sm text-dark dark:text-white sm:col-span-2">
            Efectivo contado al cierre
            <input
              value={draft.counted}
              onChange={(e) => updateDraft({ counted: e.target.value })}
              inputMode="decimal"
              placeholder="0"
              className="mt-1 w-full rounded-md border border-stroke bg-white px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            />
          </label>
        </div>
        <div className="mt-4 grid max-w-4xl gap-2 rounded-md bg-gray-1 p-4 text-sm dark:bg-white/5">
          <p>
            <span className="text-body-color dark:text-dark-6">Efectivo esperado: </span>
            <span className="font-semibold text-dark dark:text-white">{formatMoney(esperadoEfectivo)}</span>
            <span className="text-body-color dark:text-dark-6"> (apertura + efectivo estimado)</span>
          </p>
          <p>
            <span className="text-body-color dark:text-dark-6">Diferencia (contado − esperado): </span>
            <span
              className={
                "font-semibold " +
                (diferencia > 0 ? "text-green-600" : diferencia < 0 ? "text-red" : "text-dark dark:text-white")
              }
            >
              {formatMoney(diferencia)}
            </span>
          </p>
          {(safeNumber(draft.cardCreditIn) > 0 ||
            safeNumber(draft.cardDebitIn) > 0 ||
            safeNumber(draft.transferIn) > 0) && (
            <p className="border-t border-stroke pt-2 dark:border-dark-3">
              <span className="text-body-color dark:text-dark-6">Otros medios declarados (manual): </span>
              <span className="font-medium text-dark dark:text-white">
                crédito {formatMoney(draft.cardCreditIn)}, débito {formatMoney(draft.cardDebitIn)},
                transferencia {formatMoney(draft.transferIn)}
              </span>
            </p>
          )}
        </div>
        <label className="mt-4 block text-sm text-dark dark:text-white">
          Notas del cierre
          <textarea
            value={draft.note}
            onChange={(e) => updateDraft({ note: e.target.value })}
            rows={3}
            className="mt-1 w-full max-w-2xl rounded-md border border-stroke bg-white px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            placeholder="Observaciones, turno, responsable..."
          />
        </label>
      </div>

      <div className="rounded-lg border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
        <h3 className="mb-2 text-lg font-semibold text-dark dark:text-white">Detalle de ventas del día</h3>
        {loading ? (
          <p className="text-sm text-body">Cargando...</p>
        ) : sales.length === 0 ? (
          <p className="text-sm text-body">No hay ventas registradas para esta fecha.</p>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Medio de pago</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">#{s.id}</TableCell>
                    <TableCell>
                      {dayjs(s.created_at).tz(COLOMBIA_TZ).format("DD/MM/YYYY HH:mm")}
                    </TableCell>
                    <TableCell>{paymentLabel(s.payment_method)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatMoney(s.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
