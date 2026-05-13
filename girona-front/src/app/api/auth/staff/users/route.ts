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

export async function GET(request: Request) {
  const authorization = getAuthHeader(request);
  if (!authorization) {
    return NextResponse.json({ message: "Token requerido" }, { status: 401 });
  }
  const url = toAbsoluteUrl(getBackendBaseUrl(), "/auth/staff/users");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { authorization },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ message: "No se pudo conectar con el backend" }, { status: 502 });
  }
  const payload = await safeJson(response);
  if (!response.ok) {
    return NextResponse.json(payload ?? { message: "Error al listar usuarios" }, { status: response.status });
  }
  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const authorization = getAuthHeader(request);
  if (!authorization) {
    return NextResponse.json({ message: "Token requerido" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "JSON inválido" }, { status: 400 });
  }
  const url = toAbsoluteUrl(getBackendBaseUrl(), "/auth/staff/users");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ message: "No se pudo conectar con el backend" }, { status: 502 });
  }
  const payload = await safeJson(response);
  if (!response.ok) {
    return NextResponse.json(payload ?? { message: "Error al crear usuario" }, { status: response.status });
  }
  return NextResponse.json(payload);
}
