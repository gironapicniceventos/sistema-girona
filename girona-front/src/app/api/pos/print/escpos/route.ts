import type { PosPrefacturaOrder } from "@/lib/pos/prefactura";
import { buildEscPosReceiptBytes } from "@/lib/escpos/build-receipt";
import {
  isAllowedPrinterHost,
  normalizeThermalPrinterHost,
} from "@/lib/escpos/printer-host";
import { Socket } from "net";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  order?: PosPrefacturaOrder;
  tableName?: string;
  statusLabel?: string;
  dateText?: string;
  host?: string;
  port?: number;
  tipAmount?: number | null;
  /** Prioridad sobre NEXT_PUBLIC_THERMAL_PREFACTURA_QR_URL; null = sin QR */
  qrUrl?: string | null;
  qrCellSize?: number;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.order || typeof body.host !== "string" || !body.host.trim()) {
    return NextResponse.json(
      { message: "Cuerpo inválido: se requiere order y host." },
      { status: 400 },
    );
  }

  const parsed = normalizeThermalPrinterHost(body.host);
  const host = parsed.host;
  const port =
    Number(body.port) > 0
      ? Number(body.port)
      : parsed.port && parsed.port > 0
        ? parsed.port
        : 9100;

  if (!host || !isAllowedPrinterHost(host, process.env.THERMAL_PRINTER_HOST)) {
    return NextResponse.json(
      {
        message:
          "Host de impresora no válido. Use solo la IP (ej. 192.168.1.50 o 127.0.0.1), sin :631 ni rutas CUPS. Puerto ESC/POS aparte: 9100.",
      },
      { status: 403 },
    );
  }

  const buf = buildEscPosReceiptBytes(body.order, {
    tableName: body.tableName ?? `Mesa ${body.order.table_id}`,
    statusLabel: body.statusLabel ?? body.order.status,
    dateText: body.dateText ?? "",
    lineWidth: 48,
    tipAmount: body.tipAmount,
    qrUrl: body.qrUrl,
    qrCellSize: body.qrCellSize,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      socket.setTimeout(12_000);
      socket.once("error", reject);
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("Tiempo de espera agotado al conectar con la impresora."));
      });
      socket.connect(port, host, () => {
        socket.write(Buffer.from(buf), (err) => {
          if (err) {
            socket.destroy();
            reject(err);
            return;
          }
          socket.end();
          resolve();
        });
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { message: "No se pudo enviar a la impresora térmica.", detail: msg },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, bytes: buf.byteLength });
}
