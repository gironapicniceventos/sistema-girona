import { NextResponse } from "next/server";

import {
  errorToJson,
  getBackendBaseUrl,
  safeJson,
  toAbsoluteUrl,
} from "@/app/api/personnel/_utils";

type CreditNoteBody = {
  numbering_range_id?: number | null;
  observation?: string | null;
  send_email?: boolean;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ saleId?: string }> },
) {
  const { saleId } = await params;
  if (!saleId) {
    return NextResponse.json({ message: "ID de venta requerido" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as CreditNoteBody | null;
  const payload: Record<string, unknown> = {
    send_email: Boolean(body?.send_email),
  };
  if (body?.numbering_range_id != null && Number.isFinite(Number(body.numbering_range_id))) {
    payload.numbering_range_id = Number(body.numbering_range_id);
  }
  if (typeof body?.observation === "string" && body.observation.trim()) {
    payload.observation = body.observation.trim().slice(0, 250);
  }

  const backendBaseUrl = getBackendBaseUrl();
  const url = toAbsoluteUrl(backendBaseUrl, `/factus/sales/${saleId}/credit-note`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          "No se pudo conectar con el backend para la nota crédito. Verifica que Uvicorn este corriendo.",
        backendUrl: backendBaseUrl,
        triedUrl: url,
        error: errorToJson(error),
      },
      { status: 502 },
    );
  }

  const out = await safeJson(response);
  if (!response.ok) {
    const message =
      (typeof (out as any)?.detail === "string" && (out as any).detail) ||
      (typeof (out as any)?.message === "string" && (out as any).message) ||
      "No se pudo emitir la nota crédito";
    return NextResponse.json(
      { message, error: out, backendUrl: backendBaseUrl, triedUrl: url },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(out);
}
