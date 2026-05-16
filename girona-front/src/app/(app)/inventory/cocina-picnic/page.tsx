import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import PicnicInventoryModule from "@/components/Inventory/picnic-inventory-module";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inventario Cocina (Picnic)",
};

export default function InventoryPicnicPage() {
  return (
    <>
      <Breadcrumb pageName="Inventario Cocina" />
      <PicnicInventoryModule />
    </>
  );
}
