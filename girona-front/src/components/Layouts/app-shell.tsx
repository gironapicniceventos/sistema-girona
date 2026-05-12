"use client";

import { useSession } from "@/components/Auth/SessionContext";
import { Header } from "@/components/Layouts/header";
import { Sidebar } from "@/components/Layouts/sidebar";
import {
  getDefaultRouteForRole,
  isPathAllowed,
  normalizeAppPath,
} from "@/lib/auth/access";
import { readAuth } from "@/lib/auth/storage";
import { usePathname, useRouter } from "next/navigation";
import { type PropsWithChildren, useEffect, useRef } from "react";

export function AppShell({ children }: PropsWithChildren) {
  const { me, loading } = useSession();
  const pathname = usePathname() || "/";
  const router = useRouter();
  const normalizedPath = normalizeAppPath(pathname);
  const redirectedRef = useRef(false);

  useEffect(() => {
    redirectedRef.current = false;
  }, [pathname]);

  useEffect(() => {
    if (loading) return;
    const auth = readAuth();
    if (!auth?.accessToken || !me) {
      router.replace("/auth/sign-in");
      return;
    }
    if (!isPathAllowed(me.role, normalizedPath) && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace(getDefaultRouteForRole(me.role));
    }
  }, [loading, me, normalizedPath, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-gray-2 text-dark dark:bg-[#020d1a] dark:text-white">
        <p className="text-sm font-medium">Cargando sesión…</p>
      </div>
    );
  }

  const auth = readAuth();
  if (!auth?.accessToken || !me) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-gray-2 text-dark dark:bg-[#020d1a] dark:text-white">
        <p className="text-sm font-medium">Redirigiendo al inicio de sesión…</p>
      </div>
    );
  }

  if (!isPathAllowed(me.role, normalizedPath)) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-gray-2 text-dark dark:bg-[#020d1a] dark:text-white">
        <p className="text-sm font-medium">Redirigiendo…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen min-h-[100dvh]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col bg-gray-2 dark:bg-[#020d1a]">
        <Header />

        <main className="mx-auto w-full min-w-0 max-w-screen-2xl overflow-x-clip p-3 sm:p-4 md:p-6 2xl:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
