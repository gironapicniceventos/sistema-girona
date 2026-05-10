import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import Personnel from "@/components/Personnel";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Compras - Proveedores",
};

export default function ComprasProveedoresPage() {
  return (
    <>
      <Breadcrumb pageName="Compras - Proveedores" />
      <Suspense fallback={<p className="text-sm text-body">Cargando proveedores...</p>}>
        <Personnel variant="suppliersOnly" />
      </Suspense>
    </>
  );
}
