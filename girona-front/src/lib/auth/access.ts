export type AppRole =
  | "mesero"
  | "caja_mesero"
  | "admin"
  | "full_access"
  | "gerente"
  | "jefe_cocina";

export function normalizeAppPath(pathname: string): string {
  let p = pathname.split("?")[0] || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

export function isPathAllowed(role: string | undefined, pathname: string): boolean {
  const p = normalizeAppPath(pathname);
  if (p.startsWith("/auth")) return true;

  const r = (role ?? "mesero").trim();

  if (p.startsWith("/permissions")) return r === "full_access";

  if (r === "full_access") return true;

  if (r === "gerente") return true;

  if (r === "admin") {
    if (p.startsWith("/compras/proveedores")) return false;
    if (p.startsWith("/sales/cash-closing")) return true;
    if (p.startsWith("/sales")) return false;
    return true;
  }

  if (r === "jefe_cocina") {
    return (
      p.startsWith("/pos") ||
      p.startsWith("/menu") ||
      p.startsWith("/inventory") ||
      p.startsWith("/profile")
    );
  }

  if (r === "caja_mesero") {
    return (
      p.startsWith("/pos") ||
      p.startsWith("/menu") ||
      p.startsWith("/personnel") ||
      p.startsWith("/sales/cash-closing") ||
      p.startsWith("/sales/historial") ||
      p.startsWith("/profile")
    );
  }

  if (r === "mesero") {
    return p.startsWith("/pos") || p.startsWith("/menu") || p.startsWith("/profile");
  }

  return false;
}

export function getDefaultRouteForRole(role: string): string {
  const r = role.trim();
  if (r === "mesero" || r === "caja_mesero") return "/pos";
  if (r === "jefe_cocina") return "/menu";
  return "/dashboard";
}

export function isMenuReadOnly(role: string): boolean {
  return role === "mesero" || role === "caja_mesero";
}
