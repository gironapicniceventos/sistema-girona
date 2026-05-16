"use client";

import {
  orderCartTotals,
  POS_SUGGESTED_TIP_RATE,
  type PosPrefacturaOrder,
} from "@/lib/pos/prefactura";

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
}

export function PrefacturaClientePanel({
  order,
  tipInput,
  onTipInputChange,
}: {
  order: PosPrefacturaOrder;
  tipInput: string;
  onTipInputChange: (value: string) => void;
}) {
  const tipParsed = Number(tipInput);
  const tipForCalc = Number.isFinite(tipParsed) ? Math.max(0, tipParsed) : undefined;
  const ct = orderCartTotals(order, { tipAmount: tipForCalc });

  return (
    <div className="rounded-lg border border-stroke bg-gray-1 p-3 dark:border-dark-3 dark:bg-dark-2">
      <h4 className="mb-2 text-sm font-semibold text-dark dark:text-white">Pre-factura (cliente)</h4>
      <p className="mb-2 text-xs text-body-color dark:text-dark-6">
        Precios de carta (INC incluido, sin descontar). Propina sugerida al{" "}
        {Math.round(POS_SUGGESTED_TIP_RATE * 100)}%; el cliente decide si la paga.
      </p>
      <div className="space-y-1 text-sm text-dark dark:text-white">
        <div className="flex items-center justify-between">
          <span>Subtotal (carta)</span>
          <span>{formatMoney(ct.subtotalCart)}</span>
        </div>
        {ct.discount > 0 ? (
          <div className="flex items-center justify-between">
            <span>Descuentos</span>
            <span>{formatMoney(ct.discount)}</span>
          </div>
        ) : null}
        {ct.courtesy > 0 ? (
          <div className="flex items-center justify-between">
            <span>Cortesías</span>
            <span>{formatMoney(ct.courtesy)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between text-body-color dark:text-dark-6">
          <span>Propina sugerida</span>
          <span>{formatMoney(ct.suggestedTip)}</span>
        </div>
        <label className="flex items-center justify-between gap-2 pt-1">
          <span className="font-medium">Propina a cobrar</span>
          <input
            type="number"
            min={0}
            step={100}
            value={tipInput}
            onChange={(e) => onTipInputChange(e.target.value)}
            className="w-28 rounded-md border border-stroke bg-white px-2 py-1 text-right text-sm dark:border-dark-3 dark:bg-gray-dark dark:text-white"
          />
        </label>
        <div className="flex items-center justify-between border-t border-stroke pt-2 text-base font-semibold dark:border-dark-3">
          <span>Total a pagar</span>
          <span>{formatMoney(ct.totalWithTip)}</span>
        </div>
      </div>
    </div>
  );
}
