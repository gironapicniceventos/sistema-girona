import { NextResponse } from "next/server";

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

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorToJson(error: unknown) {
  if (error instanceof Error) {
    const anyError = error as unknown as Record<string, unknown>;
    return {
      name: error.name,
      message: error.message,
      code: anyError?.code,
      errno: anyError?.errno,
      syscall: anyError?.syscall,
      address: anyError?.address,
      port: anyError?.port,
      cause: anyError?.cause,
    };
  }
  return { message: String(error) };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId?: string }> },
) {
  const { orderId } = await params;
  if (!orderId) {
    return NextResponse.json({ message: "ID de orden requerido" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { waiter_id?: number } | null;
  const wid = Number(body?.waiter_id);
  if (!Number.isFinite(wid) || wid <= 0) {
    return NextResponse.json({ message: "Mesero invalido." }, { status: 400 });
  }

  const backendBaseUrl = getBackendBaseUrl();
  const url = toAbsoluteUrl(backendBaseUrl, `/pos/orders/${orderId}/waiter`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ waiter_id: wid }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          "No se pudo conectar con el backend para asignar mesero. Verifica que Uvicorn este corriendo y que BACKEND_URL sea accesible.",
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
      (typeof (payload as Record<string, unknown>)?.detail === "string" &&
        (payload as Record<string, unknown>).detail) ||
      (typeof (payload as Record<string, unknown>)?.message === "string" &&
        (payload as Record<string, unknown>).message) ||
      "No se pudo asignar el mesero";

    return NextResponse.json(
      { message, error: payload, backendUrl: backendBaseUrl, triedUrl: url },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(payload);
}
