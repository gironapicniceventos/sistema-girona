/** Normaliza IP/host introducido en el POS (quita espacios, separa puerto si viene en el mismo campo). */
export function normalizeThermalPrinterHost(raw: string): { host: string; port?: number } {
  let s = raw.trim();
  if (!s) return { host: "" };

  // Quitar esquema accidental (http://, ipp://, socket://)
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  // Quitar barra final o ruta CUPS (/printers/...)
  const slash = s.indexOf("/");
  if (slash > 0) s = s.slice(0, slash);

  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(s);
  if (bracket) {
    const port = bracket[2] ? Number(bracket[2]) : undefined;
    return { host: bracket[1].trim(), port: port && port > 0 ? port : undefined };
  }

  const hostPort = /^([^:\s]+):(\d{1,5})$/.exec(s);
  if (hostPort) {
    const port = Number(hostPort[2]);
    return {
      host: hostPort[1].trim().toLowerCase(),
      port: port > 0 && port <= 65535 ? port : undefined,
    };
  }

  return { host: s.toLowerCase() };
}

/** Impresora USB vía cola CUPS en el PC del puente (escribir "cups" en el POS). */
export function isCupsPrinterHost(host: string): boolean {
  return host.trim().toLowerCase() === "cups";
}

export function isPrivateOrLocalPrinterHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  if (isCupsPrinterHost(h)) return true;
  if (h === "localhost") return true;

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((x) => x > 255 || x < 0)) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isAllowedPrinterHost(host: string, envHost?: string): boolean {
  const normalized = normalizeThermalPrinterHost(host).host;
  const env = (envHost || "").trim();
  if (env && normalized === env.trim().toLowerCase()) return true;
  return isPrivateOrLocalPrinterHost(normalized);
}
