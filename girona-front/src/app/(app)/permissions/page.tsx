import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import PermissionsClient from "./permissions-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Permisos",
};

export default function PermissionsPage() {
  return (
    <>
      <Breadcrumb pageName="Permisos" />
      <PermissionsClient />
    </>
  );
}
