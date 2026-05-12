"use client";

import { SidebarProvider } from "@/components/Layouts/sidebar/sidebar-context";
import { SessionProvider } from "@/components/Auth/SessionContext";
import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="light" attribute="class">
      <SessionProvider>
        <SidebarProvider>{children}</SidebarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
