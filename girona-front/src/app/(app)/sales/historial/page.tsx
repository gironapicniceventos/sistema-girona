import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import Sales from "@/components/Sales";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ventas",
};

export default function SalesHistorialPage() {
  return (
    <>
      <Breadcrumb pageName="Ventas" />
      <Sales historyOnly />
    </>
  );
}
