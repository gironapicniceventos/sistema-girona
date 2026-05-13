import { NextResponse } from "next/server";

function getBackendBaseUrl() {
  return (
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:8000"
  );
}

function toAbsoluteUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function getAuthHeader(request: Request): string | null {
  const raw = request.headers.get("authorization") ?? "";
  return raw.trim() || null;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const authorization = getAuthHeader(request);
  if (!authorization) {
    return NextResponse.json({ message: "Token requerido" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "JSON inválido" }, { status: 400 });
  }
  const url = toAbsoluteUrl(getBackendBaseUrl(), `/auth/staff/users/${encodeURIComponent(id)}`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ message: "No se pudo conectar con el backend" }, { status: 502 });
  }
  const payload = await safeJson(response);
  if (!response.ok) {
    return NextResponse.json(payload ?? { message: "Error al actualizar usuario" }, { status: response.status });
  }
  return NextResponse.json(payload);
}

export async function DELETE(request: Request, { params }: Params) {
  const authorization = getAuthHeader(request);
  if (!authorization) {
    return NextResponse.json({ message: "Token requerido" }, { status: 401 });
  }
  const { id } = await params;
  const url = toAbsoluteUrl(getBackendBaseUrl(), `/auth/staff/users/${encodeURIComponent(id)}`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: { authorization },
    });
  } catch {
    return NextResponse.json({ message: "No se pudo conectar con el backend" }, { status: 502 });
  }
  const payload = await safeJson(response);
  if (!response.ok) {
    return NextResponse.json(payload ?? { message: "Error al desactivar usuario" }, { status: response.status });
  }
  return NextResponse.json(payload);
}
