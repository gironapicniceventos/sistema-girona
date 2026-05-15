import { NextResponse } from "next/server";

import { errorToJson, getBackendBaseUrl, safeJson, toAbsoluteUrl } from "../_utils";

type WaiterCreateBody = {
  name?: string;
  gender?: string;
  is_active?: boolean;
  user_id?: number | null;
};

export async function GET(request: Request) {
  const backendBaseUrl = getBackendBaseUrl();
  const requestUrl = new URL(request.url);
  const backendUrl = new URL(toAbsoluteUrl(backendBaseUrl, "/personnel/waiters"));

  const active = requestUrl.searchParams.get("active");
  if (active) backendUrl.searchParams.set("active", active);

  let response: Response;
  try {
    response = await fetch(backendUrl.toString(), { cache: "no-store" });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          "No se pudo conectar con el backend para cargar meseros. Verifica que Uvicorn esté corriendo y que `BACKEND_URL` sea accesible desde el servidor de Next.js.",
        backendUrl: backendBaseUrl,
        triedUrl: backendUrl.toString(),
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
      "No se pudo cargar meseros";

    return NextResponse.json(
      { message, error: payload, backendUrl: backendBaseUrl, triedUrl: backendUrl.toString() },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as WaiterCreateBody | null;

  if (!body) {
    return NextResponse.json({ message: "Body inválido (JSON requerido)" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const gender = (body.gender ?? "male").trim() || "male";
  if (!name) {
    return NextResponse.json({ message: "Nombre es requerido" }, { status: 400 });
  }

  const backendBaseUrl = getBackendBaseUrl();
  const url = toAbsoluteUrl(backendBaseUrl, "/personnel/waiters");

  let response: Response;
  try {
    const bodyJson: Record<string, unknown> = {
        name,
        gender,
        is_active: body.is_active ?? true,
    };
    if (body.user_id !== undefined && body.user_id !== null) {
      bodyJson.user_id = body.user_id;
    }
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyJson),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          "No se pudo conectar con el backend para crear el mesero. Verifica que Uvicorn esté corriendo y que `BACKEND_URL` sea accesible desde el servidor de Next.js.",
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
      "No se pudo crear el mesero";

    return NextResponse.json(
      { message, error: payload, backendUrl: backendBaseUrl, triedUrl: url },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(payload, { status: 201 });
}
