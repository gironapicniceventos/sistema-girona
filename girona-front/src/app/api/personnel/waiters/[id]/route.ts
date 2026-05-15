import { NextResponse } from "next/server";

import { errorToJson, getBackendBaseUrl, safeJson, toAbsoluteUrl } from "../../_utils";

type WaiterUpdateBody = {
  name?: string;
  gender?: string;
  is_active?: boolean;
  user_id?: number | null;
};

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const id = params.id;

  const body = (await request.json().catch(() => null)) as WaiterUpdateBody | null;

  if (!body) {
    return NextResponse.json({ message: "Body inválido (JSON requerido)" }, { status: 400 });
  }

  const backendBaseUrl = getBackendBaseUrl();
  const url = toAbsoluteUrl(backendBaseUrl, `/personnel/waiters/${id}`);

  const payloadToSend: Record<string, unknown> = {};
  if (body.name !== undefined) payloadToSend.name = body.name;
  if (body.gender !== undefined) payloadToSend.gender = body.gender;
  if (body.is_active !== undefined) payloadToSend.is_active = body.is_active;
  if (body.user_id !== undefined) payloadToSend.user_id = body.user_id;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadToSend),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          "No se pudo conectar con el backend para editar el mesero. Verifica que Uvicorn esté corriendo y que `BACKEND_URL` sea accesible desde el servidor de Next.js.",
        backendUrl: backendBaseUrl,
        triedUrl: url,
        error: errorToJson(error),
      },
      { status: 502 },
    );
  }

  const payload = await safeJson(response);
  if (!response.ok) {
    const message =
      (typeof (payload as any)?.detail === "string" && (payload as any).detail) ||
      (typeof (payload as any)?.message === "string" && (payload as any).message) ||
      "No se pudo editar el mesero";

    return NextResponse.json(
      { message, error: payload, backendUrl: backendBaseUrl, triedUrl: url },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(payload);
}
