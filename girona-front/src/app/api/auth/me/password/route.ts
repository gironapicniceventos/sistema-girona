import { NextResponse } from "next/server";

type Body = {
  currentPassword?: string;
  newPassword?: string;
};

function getBackendBaseUrl() {
  return (
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:8000"
  );
}

function toAbsoluteUrl(baseUrl: string, pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = baseUrl.replace(/\/$/, "");
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
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

export async function POST(request: Request) {
  const authorization = getAuthHeader(request);
  if (!authorization) {
    return NextResponse.json({ message: "Token requerido" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const current = body?.currentPassword ?? "";
  const nextPw = body?.newPassword ?? "";
  if (!current || !nextPw) {
    return NextResponse.json(
      { message: "Contraseña actual y nueva son requeridas" },
      { status: 400 },
    );
  }
  if (nextPw.length < 6) {
    return NextResponse.json(
      { message: "La nueva contraseña debe tener al menos 6 caracteres" },
      { status: 400 },
    );
  }

  const backendBaseUrl = getBackendBaseUrl();
  const url = toAbsoluteUrl(backendBaseUrl, "/auth/me/password");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        current_password: current,
        new_password: nextPw,
      }),
    });
  } catch {
    return NextResponse.json(
      { message: "No se pudo conectar con el backend", triedUrl: url },
      { status: 502 },
    );
  }

  const payload = await safeJson(response);
  if (!response.ok) {
    return NextResponse.json(
      payload ?? { message: "No se pudo cambiar la contraseña" },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(payload);
}
