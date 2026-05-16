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

export async function GET(request: Request) {
  const backendBaseUrl = getBackendBaseUrl();
  const requestUrl = new URL(request.url);
  const period = requestUrl.searchParams.get("period");
  const dateFrom = requestUrl.searchParams.get("date_from");
  const dateTo = requestUrl.searchParams.get("date_to");
  const basePath = toAbsoluteUrl(backendBaseUrl, "/sales/exports/ventas.xlsx");
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  const qs = params.toString();
  const url = qs ? `${basePath}?${qs}` : basePath;

  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    return NextResponse.json(
      { message: "No se pudo conectar con el backend para exportar ventas." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const payload = await safeJson(response);
    const message =
      (typeof (payload as { detail?: string })?.detail === "string" &&
        (payload as { detail: string }).detail) ||
      (typeof (payload as { message?: string })?.message === "string" &&
        (payload as { message: string }).message) ||
      "No se pudo generar el Excel de ventas";
    return NextResponse.json({ message }, { status: response.status || 400 });
  }

  const buffer = await response.arrayBuffer();
  const contentType =
    response.headers.get("content-type") ??
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const contentDisposition =
    response.headers.get("content-disposition") ?? 'attachment; filename="ventas.xlsx"';

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition,
    },
  });
}
