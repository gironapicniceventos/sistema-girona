import {
  formatPlainCop,
  orderCartTotals,
  prefacturaDisplayLineGross,
  prefacturaDisplayUnit,
  type PosPrefacturaOrder,
} from "@/lib/pos/prefactura";

const ESC = 0x1b;
const GS = 0x1d;

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Latin-1 + quitar tildes para impresoras sin UTF-8. */
export function encodeEscPosText(s: string): Uint8Array {
  const ascii = s.normalize("NFD").replace(/\p{M}/gu, "");
  const out: number[] = [];
  for (let i = 0; i < ascii.length; i++) {
    const c = ascii.charCodeAt(i);
    if (c === 0x0a) {
      out.push(0x0a);
      continue;
    }
    if (c < 0x20 && c !== 0x09) continue;
    if (c <= 0xff) out.push(c);
    else out.push(0x3f);
  }
  return new Uint8Array(out);
}

function line(...parts: Uint8Array[]): Uint8Array {
  const body = concatChunks(parts);
  const nl = new Uint8Array([0x0a]);
  return concatChunks([body, nl]);
}

/** Plantilla opcional para QR en ticket térmico (prefactura). Sustituye `{orderId}` o `{id}`. */
export function resolveThermalPrefacturaQrUrl(orderId: number): string | undefined {
  if (typeof process === "undefined") return undefined;
  const tpl = (process.env.NEXT_PUBLIC_THERMAL_PREFACTURA_QR_URL || "").trim();
  if (!tpl) return undefined;
  const id = String(orderId);
  return tpl.replace(/\{orderId\}/gi, id).replace(/\{id\}/gi, id);
}

export type EscPosQrOptions = {
  /** Tamaño de celda 1–8 (DIG-E200I 80 mm: 4–6 suele ser legible). */
  cellSize?: number;
  /** Epson: 48=L 49=M 50=Q 51=H */
  errorCorrection?: number;
};

/** QR modelo 2 (GS ( k) — compatible térmicas ESC/POS tipo Epson, ej. DIG-E200I. */
export function buildEscPosQrBytes(data: string, options?: EscPosQrOptions): Uint8Array {
  const encoder = new TextEncoder();
  const payload = encoder.encode(data.trim());
  /** Límite práctico para evitar comandos rotos en firmwares antiguos. */
  const max = 700;
  if (payload.length === 0 || payload.length > max) {
    return new Uint8Array(0);
  }
  const cell = Math.min(8, Math.max(1, Math.round(options?.cellSize ?? 6)));
  const ec = options?.errorCorrection ?? 49;
  const chunks: Uint8Array[] = [];
  chunks.push(new Uint8Array([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]));
  chunks.push(new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, cell]));
  chunks.push(new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ec]));
  const n = payload.length + 3;
  const pL = n & 0xff;
  const pH = (n >> 8) & 0xff;
  const storeHead = new Uint8Array([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]);
  chunks.push(concatChunks([storeHead, payload]));
  chunks.push(new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]));
  return concatChunks(chunks);
}

function dashedRule(width: number): Uint8Array {
  const w = Math.max(8, Math.min(width, 48));
  return encodeEscPosText("-".repeat(w) + "\n");
}

function wrapToWidth(textTrim: string, width: number): string[] {
  const words = textTrim.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.length <= width ? w : w.slice(0, width);
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export type EscPosReceiptMeta = {
  tableName: string;
  statusLabel: string;
  /** Texto de fecha ya formateado para el ticket */
  dateText: string;
  /** Caracteres por línea (48 ≈ 80 mm con fuente normal). */
  lineWidth?: number;
  tipAmount?: number | null;
  /** Precio unitario carta en prefactura (por ítem POS), si diffiere del calculado desde el pedido. */
  lineUnitCartOverrides?: Record<number, number>;
  /**
   * URL codificada en QR. `undefined`: usar NEXT_PUBLIC_THERMAL_PREFACTURA_QR_URL si está definida.
   * `null`: no imprimir QR aunque exista plantilla en env.
   */
  qrUrl?: string | null;
  /** Módulo QR 1–8 (solo si hay qrUrl o plantilla env). */
  qrCellSize?: number;
};

export function buildEscPosReceiptBytes(order: PosPrefacturaOrder, meta: EscPosReceiptMeta): Uint8Array {
  const w = meta.lineWidth ?? 48;
  const ct = orderCartTotals(order, {
    tipAmount: meta.tipAmount,
    lineUnitCartOverrides: meta.lineUnitCartOverrides,
  });
  const ovs = meta.lineUnitCartOverrides;
  const chunks: Uint8Array[] = [];

  chunks.push(new Uint8Array([ESC, 0x40]));

  chunks.push(line(encodeEscPosText("GIRONA")));
  chunks.push(new Uint8Array([ESC, 0x45, 0x01]));
  chunks.push(line(encodeEscPosText("PREFACTURA")));
  chunks.push(new Uint8Array([ESC, 0x45, 0x00]));
  chunks.push(line(encodeEscPosText("(No es factura DIAN)")));
  chunks.push(dashedRule(w));
  chunks.push(line(encodeEscPosText(`Pedido #${order.id}  ${meta.tableName}`)));
  chunks.push(line(encodeEscPosText(`${meta.statusLabel}  ${meta.dateText}`)));
  chunks.push(dashedRule(w));

  chunks.push(new Uint8Array([ESC, 0x45, 0x01]));
  chunks.push(line(encodeEscPosText("DETALLE (precios carta)")));
  chunks.push(new Uint8Array([ESC, 0x45, 0x00]));

  order.items.forEach((item, index) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const grossLine = prefacturaDisplayLineGross(item, ovs);
    const grossUnit = prefacturaDisplayUnit(item, ovs);

    const head = `${index + 1}. [${item.menu_item_id}]`;
    chunks.push(line(encodeEscPosText(head)));
    for (const wl of wrapToWidth(item.name ?? "", w - 1)) {
      chunks.push(line(encodeEscPosText(` ${wl}`)));
    }
    if (item.courtesy) {
      chunks.push(line(encodeEscPosText(" CORTESIA $0")));
    } else {
      chunks.push(
        line(
          encodeEscPosText(
            ` ${qty} x $${formatPlainCop(grossUnit)} = $${formatPlainCop(grossLine)}`,
          ),
        ),
      );
    }
    if (Number(item.discount_amount) > 0) {
      chunks.push(
        line(encodeEscPosText(` Desc: $${formatPlainCop(Number(item.discount_amount))}`)),
      );
    }
    chunks.push(line(new Uint8Array(0)));
  });

  chunks.push(dashedRule(w));
  chunks.push(new Uint8Array([ESC, 0x45, 0x01]));
  chunks.push(line(encodeEscPosText("TOTALES")));
  chunks.push(new Uint8Array([ESC, 0x45, 0x00]));

  const rows: [string, number][] = [
    ["Subtotal carta", ct.subtotalCart],
    ["Descuentos", ct.discount],
    ["Cortesias", ct.courtesy],
    ["Propina sugerida (10%)", ct.suggestedTip],
    ["Propina", ct.tipAmount],
  ];
  for (const [label, val] of rows) {
    if (val <= 0 && label.startsWith("Desc")) continue;
    if (val <= 0 && label.startsWith("Cort")) continue;
    chunks.push(line(encodeEscPosText(`${label}: $${formatPlainCop(val)}`)));
  }
  chunks.push(new Uint8Array([ESC, 0x45, 0x01]));
  chunks.push(line(encodeEscPosText(`TOTAL: $${formatPlainCop(ct.totalWithTip)}`)));
  chunks.push(new Uint8Array([ESC, 0x45, 0x00]));

  let effectiveQr: string | undefined;
  if (meta.qrUrl === null) {
    effectiveQr = undefined;
  } else if (typeof meta.qrUrl === "string" && meta.qrUrl.trim()) {
    effectiveQr = meta.qrUrl.trim();
  } else {
    effectiveQr = resolveThermalPrefacturaQrUrl(order.id);
  }
  if (effectiveQr) {
    const qrBytes = buildEscPosQrBytes(effectiveQr, { cellSize: meta.qrCellSize });
    if (qrBytes.length > 0) {
      chunks.push(line(new Uint8Array(0)));
      chunks.push(new Uint8Array([ESC, 0x61, 0x01]));
      chunks.push(line(encodeEscPosText("Codigo QR")));
      chunks.push(qrBytes);
      chunks.push(new Uint8Array([0x0a]));
      chunks.push(new Uint8Array([ESC, 0x61, 0x00]));
    }
  }

  chunks.push(line(new Uint8Array(0)));
  for (const wl of wrapToWidth(
    "Prefactura informativa. Propina opcional; IVA discriminado solo en factura electronica.",
    w,
  )) {
    chunks.push(line(encodeEscPosText(wl)));
  }

  chunks.push(line(new Uint8Array(0)));
  chunks.push(new Uint8Array([GS, 0x56, 0x00]));
  chunks.push(new Uint8Array([0x0a, 0x0a]));

  return concatChunks(chunks);
}
