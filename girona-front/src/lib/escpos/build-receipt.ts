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
