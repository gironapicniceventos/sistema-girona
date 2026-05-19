import jsPDF from "jspdf";
import { toColombiaTime } from "@/lib/pos/order-recency";
import {
  formatPlainCop,
  orderCartTotals,
  POS_SUGGESTED_TIP_RATE,
  prefacturaDisplayLineGross,
  prefacturaDisplayUnit,
  type PosPrefacturaOrder,
} from "@/lib/pos/prefactura";

const THERMAL_PAGE_MM = { w: 72, h: 200 } as const;

export type PrefacturaPdfExtras = {
  lineUnitCartOverrides?: Record<number, number>;
};

export function buildPrefacturaPdf(
  order: PosPrefacturaOrder,
  tableName: string,
  statusLabel: string,
  tipAmount?: number | null,
  extras?: PrefacturaPdfExtras,
) {
  const ovs = extras?.lineUnitCartOverrides;
  const doc = new jsPDF();
  const createdAt = toColombiaTime(order.opened_at);
  const ct = orderCartTotals(order, { tipAmount, lineUnitCartOverrides: ovs });

  doc.setFontSize(14);
  doc.text("PREFACTURA", 14, 14);
  doc.setFontSize(9);
  doc.text("(Documento informativo — no es factura electrónica DIAN)", 14, 20);
  doc.setFontSize(10);
  doc.text(`Pedido #${order.id} · Mesa: ${tableName} · Estado: ${statusLabel}`, 14, 28);
  doc.text(
    `Creado: ${createdAt?.isValid() ? createdAt.format("DD/MM/YYYY HH:mm") : "—"}`,
    14,
    34,
  );

  let y = 42;
  doc.setFontSize(7);
  doc.text("#", 12, y);
  doc.text("Cod", 18, y);
  doc.text("Descripcion", 30, y);
  doc.text("P. carta", 118, y);
  doc.text("Cant", 140, y);
  doc.text("Desc", 152, y);
  doc.text("Total", 180, y);
  y += 4;
  doc.line(10, y, 200, y);
  y += 5;

  order.items.forEach((item, index) => {
    if (y > 265) {
      doc.addPage();
      y = 16;
    }
    const qty = Math.max(1, Number(item.quantity) || 1);
    const grossUnit = prefacturaDisplayUnit(item, ovs);
    const grossLine = prefacturaDisplayLineGross(item, ovs);
    const descAmt = Number(item.discount_amount) || 0;

    doc.text(String(index + 1), 12, y);
    doc.text(String(item.menu_item_id), 18, y);
    const desc = doc.splitTextToSize(String(item.name), 85);
    doc.text(desc, 30, y);
    doc.text(formatPlainCop(grossUnit), 132, y, { align: "right" });
    doc.text(String(qty), 144, y);
    doc.text(formatPlainCop(descAmt), 162, y, { align: "right" });
    doc.text(formatPlainCop(grossLine), 198, y, { align: "right" });
    y += Math.max(6, (desc as string[]).length * 4);
  });

  y += 4;
  doc.setFontSize(9);
  doc.text(`Pedido POS #${order.id}`, 14, y);
  y += 6;
  doc.text(`Subtotal (carta) $ ${formatPlainCop(ct.subtotalCart)}`, 14, y);
  y += 5;
  if (ct.discount > 0) {
    doc.text(`Descuentos $ ${formatPlainCop(ct.discount)}`, 14, y);
    y += 5;
  }
  if (ct.courtesy > 0) {
    doc.text(`Cortesías $ ${formatPlainCop(ct.courtesy)}`, 14, y);
    y += 5;
  }
  doc.text(
    `Propina sugerida (${Math.round(POS_SUGGESTED_TIP_RATE * 100)}%) $ ${formatPlainCop(ct.suggestedTip)}`,
    14,
    y,
  );
  y += 5;
  doc.text(`Propina $ ${formatPlainCop(ct.tipAmount)}`, 14, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.text(`Total a pagar $ ${formatPlainCop(ct.totalWithTip)}`, 14, y);
  doc.setFont("helvetica", "normal");
  y += 6;
  doc.setFontSize(7);
  doc.text(
    "La discriminación de IVA solo aplica al emitir la factura electrónica. El cliente decide si paga la propina.",
    14,
    y,
    { maxWidth: 180 },
  );

  return doc;
}

export function buildThermalReceiptPdf(
  order: PosPrefacturaOrder,
  tableName: string,
  statusLabel: string,
  tipAmount?: number | null,
  extras?: PrefacturaPdfExtras,
) {
  const ovs = extras?.lineUnitCartOverrides;
  const doc = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: [THERMAL_PAGE_MM.w, THERMAL_PAGE_MM.h],
  });
  const margin = 3.5;
  const pageW = THERMAL_PAGE_MM.w;
  const maxTextW = pageW - margin * 2;
  const createdAt = toColombiaTime(order.opened_at);
  const ct = orderCartTotals(order, { tipAmount, lineUnitCartOverrides: ovs });

  let y = 6;
  const lh = 3.5;

  function newPage() {
    doc.addPage([THERMAL_PAGE_MM.w, THERMAL_PAGE_MM.h], "p");
    y = 6;
  }

  function needSpace(h: number) {
    const ph = doc.internal.pageSize.getHeight();
    if (y + h > ph - 4) newPage();
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("GIRONA", pageW / 2, y, { align: "center" });
  y += lh;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Prefactura 80 mm", pageW / 2, y, { align: "center" });
  y += lh * 0.9;
  doc.text("(No constituye factura DIAN)", pageW / 2, y, { align: "center" });
  y += lh * 1.3;

  doc.setDrawColor(90);
  doc.line(margin, y, pageW - margin, y);
  y += lh * 1.1;

  doc.setFontSize(7.5);
  doc.text(`Pedido #${order.id} · ${tableName}`, margin, y);
  y += lh;
  doc.text(
    `${statusLabel} · ${createdAt?.isValid() ? createdAt.format("DD/MM/YYYY HH:mm") : "—"}`,
    margin,
    y,
  );
  y += lh * 1.2;
  doc.line(margin, y, pageW - margin, y);
  y += lh * 1.1;

  doc.setFont("helvetica", "bold");
  doc.text("DETALLE", margin, y);
  y += lh * 1.1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);

  order.items.forEach((item, index) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const grossUnit = prefacturaDisplayUnit(item, ovs);
    const grossLine = prefacturaDisplayLineGross(item, ovs);
    const head = `${index + 1}. [${item.menu_item_id}]`;
    const nameLines = doc.splitTextToSize(String(item.name), maxTextW - 1) as string[];
    needSpace(nameLines.length * lh + lh * 3.5);
    doc.text(head, margin, y);
    y += lh * 0.95;
    doc.text(nameLines, margin + 1, y);
    y += nameLines.length * lh;
    if (item.courtesy) {
      doc.text("CORTESIA · $0", margin + 1, y);
    } else {
      doc.text(
        `${qty} x $${formatPlainCop(grossUnit)} = $${formatPlainCop(grossLine)}`,
        margin + 1,
        y,
      );
    }
    y += lh;
    if (Number(item.discount_amount) > 0) {
      doc.text(`Desc: $${formatPlainCop(Number(item.discount_amount))}`, margin + 1, y);
      y += lh * 0.95;
    }
    y += 1;
  });

  needSpace(lh * 12);
  doc.line(margin, y, pageW - margin, y);
  y += lh * 1.2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("TOTALES", margin, y);
  y += lh * 1.2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);

  const totalRows: [string, number][] = [
    ["Subtotal carta", ct.subtotalCart],
    ["Propina sugerida", ct.suggestedTip],
    ["Propina", ct.tipAmount],
  ];
  totalRows.forEach(([label, val]) => {
    if (val <= 0 && label !== "Subtotal carta") return;
    needSpace(lh);
    doc.text(label, margin, y);
    doc.text(`$${formatPlainCop(val)}`, pageW - margin, y, { align: "right" });
    y += lh;
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  needSpace(lh * 1.8);
  doc.text("TOTAL", margin, y);
  doc.text(`$${formatPlainCop(ct.totalWithTip)}`, pageW - margin, y, { align: "right" });
  y += lh * 1.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.3);
  const foot = doc.splitTextToSize(
    `Pedido #${order.id}. Documento informativo. Propina opcional; IVA discriminado solo en factura electronica.`,
    maxTextW,
  ) as string[];
  needSpace(foot.length * lh);
  doc.text(foot, margin, y);

  return doc;
}
