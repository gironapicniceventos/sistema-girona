import { NextResponse } from "next/server";

type RecipeUpdateBody = {
  name?: string;
  yield_quantity?: string | number;
  unit?: string | null;
  ingredients?: Array<{
    name?: string;
    unit?: string;
    quantity?: string | number;
    product_id?: number;
    waste_pct?: string | number;
  }>;
  notes?: string | null;
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

function getIdFromRequest(request: Request, id?: string) {
  if (id) return id;
  const pathname = new URL(request.url).pathname;
  const fallback = pathname.split("/").filter(Boolean).pop();
  return fallback ?? "";
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const body = (await request.json().catch(() => null)) as RecipeUpdateBody | null;
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

  const { id: paramId } = await params;
  const id = getIdFromRequest(request, paramId);
  if (!id) {
    return NextResponse.json({ message: "Id inválido" }, { status: 400 });
  }

  const backendBaseUrl = getBackendBaseUrl();
  const url = toAbsoluteUrl(backendBaseUrl, `/inventory/recipes/${id}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        yield_quantity: body.yield_quantity,
        unit: body.unit ?? null,
        ingredients: body.ingredients ?? [],
        notes: body.notes ?? null,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          "No se pudo conectar con el backend para actualizar la receta. Verifica que Uvicorn esté corriendo y que `BACKEND_URL` sea accesible desde el servidor de Next.js.",
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
      "No se pudo actualizar la receta";

    return NextResponse.json(
      { message, error: payload, backendUrl: backendBaseUrl, triedUrl: url },
      { status: response.status || 400 },
    );
  }

  return NextResponse.json(payload);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: paramId } = await params;
  const id = getIdFromRequest(request, paramId);
  if (!id) {
    return NextResponse.json({ message: "Id inválido" }, { status: 400 });
  }
  const backendBaseUrl = getBackendBaseUrl();
  const url = toAbsoluteUrl(backendBaseUrl, `/inventory/recipes/${id}`);

  let response: Response;
  try {
    response = await fetch(url, { method: "DELETE" });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          "No se pudo conectar con el backend para eliminar la receta. Verifica que Uvicorn esté corriendo y que `BACKEND_URL` sea accesible desde el servidor de Next.js.",
        backendUrl: backendBaseUrl,
        triedUrl: url,
        error: errorToJson(error),
      },
      { status: 502 },
    );
  }

  if (!response.ok && response.status !== 204) {
    const payload = await safeJson(response);
    const message =
      (typeof (payload as any)?.detail === "string" && (payload as any).detail) ||
      (typeof (payload as any)?.message === "string" && (payload as any).message) ||
      "No se pudo eliminar la receta";

    return NextResponse.json(
      { message, error: payload, backendUrl: backendBaseUrl, triedUrl: url },
      { status: response.status || 400 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
