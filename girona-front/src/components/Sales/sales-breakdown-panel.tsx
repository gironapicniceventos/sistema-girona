"use client";

import type { SalesBreakdownAgg } from "./aggregate-sales-breakdown";

function defaultFormatMoney(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
}

const PAYMENT_ROWS: Array<{
  key: keyof SalesBreakdownAgg["byPayment"];
  label: string;
}> = [
  { key: "efectivo", label: "Efectivo" },
  { key: "datofono", label: "Datáfono" },
  { key: "qr", label: "QR" },
  { key: "nequi", label: "Nequi" },
  { key: "otro", label: "Otro" },
  { key: "sinEspecificar", label: "Sin medio registrado" },
];

type Props = {
  title: string;
  subtitle?: string;
  loading: boolean;
  breakdown: SalesBreakdownAgg;
  /** Compras (egresos) en el mismo criterio de fechas o periodo. */
  purchasesTotal: number;
  showPurchasesRow?: boolean;
  formatMoney?: (value: number) => string;
};

export default function SalesBreakdownPanel({
  title,
  subtitle,
  loading,
  breakdown,
  purchasesTotal,
  showPurchasesRow = true,
  formatMoney = defaultFormatMoney,
}: Props) {
  const m = formatMoney;
  const ingMenosEgresos = breakdown.totalFacturado - purchasesTotal;

  return (
    <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-dark-3 dark:bg-gray-dark">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-black dark:text-white">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-body dark:text-body">{subtitle}</p> : null}
      </div>
      {loading ? (
        <p className="text-sm text-body">Cargando totales…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-dark dark:text-white">Desglose de la venta (montos)</h4>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full table-auto text-sm">
                <tbody>
                  <tr className="border-b border-stroke dark:border-dark-3">
                    <td className="py-2 pr-2 text-body-color dark:text-dark-6">Total facturado (completo)</td>
                    <td className="py-2 text-right font-semibold text-dark dark:text-white">
                      {m(breakdown.totalFacturado)}
                    </td>
                  </tr>
                  <tr className="border-b border-stroke dark:border-dark-3">
                    <td className="py-2 pr-2 text-body-color dark:text-dark-6">Subtotal (base ítems)</td>
                    <td className="py-2 text-right text-dark dark:text-white">{m(breakdown.totalSubtotal)}</td>
                  </tr>
                  <tr className="border-b border-stroke dark:border-dark-3">
                    <td className="py-2 pr-2 text-body-color dark:text-dark-6">Descuentos</td>
                    <td className="py-2 text-right text-dark dark:text-white">
                      {m(breakdown.totalDescuentos)}
                    </td>
                  </tr>
                  <tr className="border-b border-stroke dark:border-dark-3">
                    <td className="py-2 pr-2 text-body-color dark:text-dark-6">Cortesías</td>
                    <td className="py-2 text-right text-dark dark:text-white">
                      {m(breakdown.totalCortesias)}
                    </td>
                  </tr>
                  <tr className="border-b border-stroke dark:border-dark-3">
                    <td className="py-2 pr-2 text-body-color dark:text-dark-6">INC (impuesto)</td>
                    <td className="py-2 text-right text-dark dark:text-white">{m(breakdown.totalInc)}</td>
                  </tr>
                  <tr className="border-b border-stroke dark:border-dark-3">
                    <td className="py-2 pr-2 text-body-color dark:text-dark-6">Propinas / servicio</td>
                    <td className="py-2 text-right text-dark dark:text-white">
                      {m(breakdown.totalPropinas)}
                    </td>
                  </tr>
                  {showPurchasesRow ? (
                    <>
                      <tr className="border-b border-stroke dark:border-dark-3">
                        <td className="py-2 pr-2 text-body-color dark:text-dark-6">Compras (egresos, mismo criterio)</td>
                        <td className="py-2 text-right text-dark dark:text-white">{m(purchasesTotal)}</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-2 font-medium text-dark dark:text-white">
                          Ventas − compras (referencia)
                        </td>
                        <td
                          className={
                            "py-2 text-right font-semibold " +
                            (ingMenosEgresos >= 0 ? "text-green-600" : "text-red")
                          }
                        >
                          {m(ingMenosEgresos)}
                        </td>
                      </tr>
                    </>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-body-color dark:text-dark-6">
              “Total facturado” es la suma del campo total de cada venta. Los importes de INC, servicio, cortesías
              y descuentos se muestran por separado según el registro de cada factura.
            </p>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-dark dark:text-white">Total facturado por medio de pago</h4>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full table-auto text-sm">
                <thead>
                  <tr className="bg-gray-2 text-left dark:bg-dark-2">
                    <th className="px-2 py-2 font-medium text-dark dark:text-white">Medio</th>
                    <th className="px-2 py-2 text-right font-medium text-dark dark:text-white">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {PAYMENT_ROWS.map(({ key, label }) => (
                    <tr key={key} className="border-b border-stroke dark:border-dark-3">
                      <td className="px-2 py-1.5 text-body-color dark:text-dark-6">{label}</td>
                      <td className="px-2 py-1.5 text-right font-medium text-dark dark:text-white">
                        {m(breakdown.byPayment[key])}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-1 font-semibold dark:bg-white/5">
                    <td className="px-2 py-2 text-dark dark:text-white">Suma de medios</td>
                    <td className="px-2 py-2 text-right text-dark dark:text-white">
                      {m(
                        breakdown.byPayment.efectivo +
                          breakdown.byPayment.datofono +
                          breakdown.byPayment.qr +
                          breakdown.byPayment.nequi +
                          breakdown.byPayment.otro +
                          breakdown.byPayment.sinEspecificar,
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-body-color dark:text-dark-6">
              La suma de medios de pago coincide con el total facturado si todos los cierres tienen el medio
              indicado. Medios de pago distintos a los anteriores se acumulan en “Otro”.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
