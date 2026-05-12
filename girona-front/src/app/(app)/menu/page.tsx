import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import MenuWithRole from "./menu-with-role";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Menu",
};

function getBackendBaseUrl() {
  return (
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:8000"
  );
}

async function getMenuItems() {
  const baseUrl = getBackendBaseUrl().replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/menu/items`, { cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo cargar el menú");
  return (await response.json()) as Array<{
    id: number;
    name: string;
    category: string;
    price: string;
    description?: string | null;
    ingredients?: Array<{
      name: string;
      unit: string;
      weight: string | number;
      price: string | number;
      total?: string | number;
    }> | string[] | null;
  }>;
}

export default async function MenuPage() {
  // No silenciar errores como []: eso reemplaza el estado del cliente y parece que
  // "desapareció" el menú o ítems recién creados tras un refresh fallido.
  const items = await getMenuItems();
  return (
    <>
      <Breadcrumb pageName="Menu" />
      <MenuWithRole items={items} />
    </>
  );
}
