export function getBackendBaseUrl() {
  return (
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:8000"
  );
}

export function toAbsoluteUrl(baseUrl: string, pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = baseUrl.replace(/\/$/, "");
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

export async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function errorToJson(error: unknown) {
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

/** Mensaje legible desde respuestas FastAPI/Pydantic (detail string o lista) y payloads similares. */
export function formatApiErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const msg = p.message;
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  const detail = p.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const parts: string[] = [];
    for (const e of detail) {
      if (typeof e === "string" && e.trim()) {
        parts.push(e.trim());
        continue;
      }
      if (e && typeof e === "object") {
        const row = e as Record<string, unknown>;
        const m = row.msg;
        if (typeof m === "string" && m.trim()) {
          parts.push(m.trim());
          continue;
        }
        const loc = Array.isArray(row.loc) ? row.loc.join(".") : "";
        const type = typeof row.type === "string" ? row.type : "";
        if (loc || type) parts.push([loc, type].filter(Boolean).join(" "));
      }
    }
    if (parts.length) return parts.join("; ");
  }
  return "";
}

/** Reenvía el `Authorization` del navegador al backend (sesión Bearer). */
export function forwardAuthHeadersFromRequest(request: Request): HeadersInit {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return {};
  return { authorization };
}