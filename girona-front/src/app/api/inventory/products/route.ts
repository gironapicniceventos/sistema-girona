import { NextResponse } from "next/server";

import { forwardAuthHeadersFromRequest } from "../../personnel/_utils";

type InventoryProductCreateBody = {
  name?: string;
  sku?: string | null;
  kind?: "ingredient" | "material" | "product";
  unit?: string | null;
  initial_quantity?: string | number;
  total_cost?: string | number;
  is_active?: boolean;
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

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorToJson(error: unknown) {
  if (error instanceof Error) {
    const anyError = error as any;
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

export async function GET(request: Request) {
  const backendBaseUrl = getBackendBaseUrl();
  const requestUrl = new URL(request.url);
  const backendUrl = new URL(toAbsoluteUrl(backendBaseUrl, "/inventory/products"));

  const kind = requestUrl.searchParams.get("kind");
  const active = requestUrl.searchParams.get("active");
  const sort = requestUrl.searchParams.get("sort");
  if (kind) backendUrl.searchParams.set("kind", kind);
  if (active) backendUrl.searchParams.set("active", active);
  if (sort) backendUrl.searchParams.set("sort", sort);

  let response: Response;
  try {
    response = await fetch(backendUrl.toString(), {
      cache: "no-store",
      headers: forwardAuthHeadersFromRequest(request),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          "No se pudo conectar con el backend para cargar inventario. Verifica que Uvicorn esté corriendo y que `BACKEND_URL` sea accesible desde el servidor de Next.js.",
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
      "No se pudo cargar inventario";

    return NextResponse.json(
      { message, error: payload, backendUrl: backendBaseUrl, triedUrl: backendUrl.toString() },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | InventoryProductCreateBody
    | null;

  if (!body) {
    return NextResponse.json(
      { message: "Body inválido (JSON requerido)" },
      { status: 400 },
    );
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ message: "Nombre es requerido" }, { status: 400 });
  }

  const kind = body.kind ?? "ingredient";
  const unit =
    body.unit === null || body.unit === undefined ? null : String(body.unit).trim();
  const initial_quantity = body.initial_quantity ?? "";
  const total_cost = body.total_cost ?? "";

  if (initial_quantity === "" || total_cost === "") {
    return NextResponse.json(
      { message: "Cantidad y costo total son requeridos" },
      { status: 400 },
    );
  }

  const backendBaseUrl = getBackendBaseUrl();
  const url = toAbsoluteUrl(backendBaseUrl, "/inventory/products");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...forwardAuthHeadersFromRequest(request),
      },
      body: JSON.stringify({
        name,
        sku: body.sku ?? null,
        kind,
        unit,
        initial_quantity,
        total_cost,
        is_active: body.is_active ?? true,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          "No se pudo conectar con el backend para crear el producto. Verifica que Uvicorn esté corriendo y que `BACKEND_URL` sea accesible desde el servidor de Next.js.",
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
      "No se pudo crear el producto";

    return NextResponse.json(
      { message, error: payload, backendUrl: backendBaseUrl, triedUrl: url },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(payload, { status: 201 });
}
