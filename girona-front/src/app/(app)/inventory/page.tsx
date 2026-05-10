import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import Inventory from "@/components/Inventory";
import InventoryManualBudget from "@/components/Inventory/inventory-manual-budget";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inventario",
};

export default async function InventoryPage() {
  return (
    <>
      <Breadcrumb pageName="Inventario" />
      <InventoryManualBudget />
      <Inventory />
    </>
  );
}
