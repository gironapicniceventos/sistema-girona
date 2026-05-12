"use client";

import Menu from "@/components/Menu";
import { useSession } from "@/components/Auth/SessionContext";
import { isMenuReadOnly } from "@/lib/auth/access";
import type { ComponentProps } from "react";

export default function MenuWithRole({
  items,
}: {
  items: ComponentProps<typeof Menu>["items"];
}) {
  const { me } = useSession();
  const readOnly = me ? isMenuReadOnly(me.role) : true;
  return <Menu items={items} readOnly={readOnly} />;
}
