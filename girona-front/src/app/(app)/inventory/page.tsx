import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import Inventory from "@/components/Inventory";
import InventoryManualBudget from "@/components/Inventory/inventory-manual-budget";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Inventario",
};

export default async function InventoryPage() {
  return (
    <>
      <Breadcrumb pageName="Inventario" />
      <InventoryManualBudget />
      <Suspense fallback={<p className="text-sm text-body-color dark:text-dark-6">Cargando inventario…</p>}>
        <Inventory />
      </Suspense>
    </>
  );
}
