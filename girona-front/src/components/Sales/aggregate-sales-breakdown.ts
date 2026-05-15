import dayjs, { type Dayjs } from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);

const COLOMBIA_TZ = "America/Bogota";

const DATOFONO_CODES = new Set(["datofono", "tarjeta", "tarjeta_credito", "tarjeta_debito"]);

export type TimeFilter = "all" | "week" | "month" | "quarter" | "year" | "custom";

export type SaleRowLike = {
  total: unknown;
  subtotal: unknown;
  tax_total: unknown;
  service_total: unknown;
  courtesy_total: unknown;
  discount_total: unknown;
  payment_method?: string | null;
};

export type SalesBreakdownAgg = {
  n: number;
  totalFacturado: number;
  totalSubtotal: number;
  totalInc: number;
  totalPropinas: number;
  totalCortesias: number;
  totalDescuentos: number;
  byPayment: {
    efectivo: number;
    datofono: number;
    qr: number;
    nequi: number;
    otro: number;
    sinEspecificar: number;
  };
};

function n(value: unknown) {
  const x = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(x) ? x : 0;
}

export function aggregateSalesBreakdown(sales: SaleRowLike[]): SalesBreakdownAgg {
  const byPayment: SalesBreakdownAgg["byPayment"] = {
    efectivo: 0,
    datofono: 0,
    qr: 0,
    nequi: 0,
    otro: 0,
    sinEspecificar: 0,
  };
  let totalFacturado = 0;
  let totalSubtotal = 0;
  let totalInc = 0;
  let totalPropinas = 0;
  let totalCortesias = 0;
  let totalDescuentos = 0;
  for (const s of sales) {
    const t = n(s.total);
    totalFacturado += t;
    totalSubtotal += n(s.subtotal);
    totalInc += n(s.tax_total);
    totalPropinas += n(s.service_total);
    totalCortesias += n(s.courtesy_total);
    totalDescuentos += n(s.discount_total);
    const code = (s.payment_method ?? "").toLowerCase().trim();
    if (!code) {
      byPayment.sinEspecificar += t;
    } else if (code === "efectivo") {
      byPayment.efectivo += t;
    } else if (DATOFONO_CODES.has(code)) {
      byPayment.datofono += t;
    } else if (code === "qr" || code === "transferencia") {
      byPayment.qr += t;
    } else if (code === "nequi" || code === "billetera") {
      byPayment.nequi += t;
    } else {
      byPayment.otro += t;
    }
  }
  return {
    n: sales.length,
    totalFacturado,
    totalSubtotal,
    totalInc,
    totalPropinas,
    totalCortesias,
    totalDescuentos,
    byPayment,
  };
}

const PERIOD_DAYS: Record<Exclude<TimeFilter, "custom">, number | null> = {
  all: null,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

export function filterPurchasesByTimeFilter<T extends { created_at: string }>(
  purchases: T[],
  period: TimeFilter,
  customRange?: { from: string; to: string } | null,
): T[] {
  if (period === "custom" && customRange?.from?.trim() && customRange?.to?.trim()) {
    const r0 = dayjs.tz(`${customRange.from.trim()} 00:00:00`, COLOMBIA_TZ);
    const r1 = dayjs.tz(`${customRange.to.trim()} 00:00:00`, COLOMBIA_TZ);
    if (!r0.isValid() || !r1.isValid()) return purchases;
    return filterPurchasesByYmdRange(purchases, r0, r1);
  }
  const days = period === "custom" ? null : PERIOD_DAYS[period];
  if (days == null) return purchases;
  const cutoff = dayjs().tz(COLOMBIA_TZ).subtract(days, "day");
  return purchases.filter((p) => {
    const t = dayjs(p.created_at).tz(COLOMBIA_TZ);
    if (!t.isValid()) return false;
    return t.valueOf() >= cutoff.valueOf();
  });
}

export function filterPurchasesByYmdRange<T extends { created_at: string }>(
  purchases: T[],
  rangeStart: Dayjs,
  rangeEnd: Dayjs,
): T[] {
  const r0 = rangeStart.tz(COLOMBIA_TZ).startOf("day");
  const r1 = rangeEnd.tz(COLOMBIA_TZ).endOf("day");
  return purchases.filter((p) => {
    const t = dayjs(p.created_at).tz(COLOMBIA_TZ);
    if (!t.isValid()) return false;
    const x = t.valueOf();
    return x >= r0.valueOf() && x <= r1.valueOf();
  });
}

export function sumPurchaseTotalCost<T extends { total_cost: unknown }>(purchases: T[]): number {
  return purchases.reduce((acc, p) => acc + n(p.total_cost), 0);
}
