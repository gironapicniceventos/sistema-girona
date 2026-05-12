export type AppRole =
  | "mesero"
  | "caja_mesero"
  | "admin"
  | "full_access";

export function normalizeAppPath(pathname: string): string {
  let p = pathname.split("?")[0] || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

export function isPathAllowed(role: string | undefined, pathname: string): boolean {
  const p = normalizeAppPath(pathname);
  if (p.startsWith("/auth")) return true;

  const r = (role ?? "mesero") as AppRole | string;

  if (r === "full_access") return true;

  if (r === "admin") {
    if (p.startsWith("/compras/proveedores")) return false;
    if (p.startsWith("/sales/cash-closing")) return true;
    if (p.startsWith("/sales")) return false;
    return true;
  }

  if (r === "caja_mesero") {
    return (
      p.startsWith("/pos") ||
      p.startsWith("/menu") ||
      p.startsWith("/personnel") ||
      p.startsWith("/sales/cash-closing") ||
      p.startsWith("/profile")
    );
  }

  if (r === "mesero") {
    return p.startsWith("/pos") || p.startsWith("/menu") || p.startsWith("/profile");
  }

  return false;
}

export function getDefaultRouteForRole(role: string): string {
  if (role === "mesero" || role === "caja_mesero") return "/pos";
  return "/dashboard";
}

export function isMenuReadOnly(role: string): boolean {
  return role === "mesero" || role === "caja_mesero";
}
