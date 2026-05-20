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

function formatBackendDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") {
    const t = detail.trim();
    return t.length > 0 ? t : undefined;
  }
  if (Array.isArray(detail)) {
    const parts = detail.map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "msg" in entry && typeof (entry as { msg: unknown }).msg === "string") {
        return (entry as { msg: string }).msg;
      }
      try {
        return JSON.stringify(entry);
      } catch {
        return "";
      }
    });
    const joined = parts.filter((s) => s.length > 0).join("; ");
    return joined.length > 0 ? joined : undefined;
  }
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

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
    const detailText = formatBackendDetail((out as Record<string, unknown>)?.detail);
    const rawMsg = (out as Record<string, unknown>)?.message;
    const fallbackMsg =
      typeof rawMsg === "string" && rawMsg.trim().length > 0 ? rawMsg.trim() : undefined;
    const message = detailText || fallbackMsg || "No se pudo emitir la nota crédito";
    return NextResponse.json(
      { message, error: out, backendUrl: backendBaseUrl, triedUrl: url },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(out);
}
