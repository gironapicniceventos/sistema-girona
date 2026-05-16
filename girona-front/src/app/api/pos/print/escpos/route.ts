import type { PosPrefacturaOrder } from "@/lib/pos/prefactura";
import { buildEscPosReceiptBytes } from "@/lib/escpos/build-receipt";
import { Socket } from "net";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPrivateOrLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === "localhost") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((x) => x > 255 || x < 0)) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function allowPrinterHost(host: string): boolean {
  const env = (process.env.THERMAL_PRINTER_HOST || "").trim();
  if (env && host.trim() === env) return true;
  return isPrivateOrLocalHost(host);
}

type Body = {
  order?: PosPrefacturaOrder;
  tableName?: string;
  statusLabel?: string;
  dateText?: string;
  host?: string;
  port?: number;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.order || typeof body.host !== "string" || !body.host.trim()) {
    return NextResponse.json(
      { message: "Cuerpo inválido: se requiere order y host." },
      { status: 400 },
    );
  }

  const host = body.host.trim();
  const port = Number(body.port) > 0 ? Number(body.port) : 9100;

  if (!allowPrinterHost(host)) {
    return NextResponse.json(
      {
        message:
          "Host de impresora no permitido. Use IP de red privada (10.x, 192.168.x, 172.16-31.x, 127.x), localhost, o configure THERMAL_PRINTER_HOST.",
      },
      { status: 403 },
    );
  }

  const buf = buildEscPosReceiptBytes(body.order, {
    tableName: body.tableName ?? `Mesa ${body.order.table_id}`,
    statusLabel: body.statusLabel ?? body.order.status,
    dateText: body.dateText ?? "",
    lineWidth: 48,
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
