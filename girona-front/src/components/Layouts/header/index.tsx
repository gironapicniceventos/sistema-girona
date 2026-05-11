"use client";

import Image from "next/image";
import Link from "next/link";
import { useSidebarContext } from "../sidebar/sidebar-context";
import { MenuIcon } from "./icons";
import { Notification } from "./notification";
import { ThemeToggleSwitch } from "./theme-toggle";
import { UserInfo } from "./user-info";

export function Header() {
  const { toggleSidebar, isMobile } = useSidebarContext();

  return (
    <header className="sticky top-0 z-30 flex min-h-[4.25rem] items-center gap-2 border-b border-stroke bg-white px-2 py-3 shadow-1 dark:border-gray-800 dark:bg-gray-dark [padding-left:max(0.5rem,env(safe-area-inset-left))] [padding-right:max(0.5rem,env(safe-area-inset-right))] sm:gap-3 sm:px-4 sm:py-4 md:px-5 2xl:px-10">
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={toggleSidebar}
          className="shrink-0 rounded-lg border px-1.5 py-1.5 dark:border-stroke-dark dark:bg-[#020D1A] hover:dark:bg-[#FFFFFF1A] lg:hidden"
        >
          <MenuIcon />
          <span className="sr-only">Abrir o cerrar menú</span>
        </button>

        {isMobile ? (
          <Link href="/" className="hidden shrink-0 min-[420px]:block">
            <Image
              src="/images/logo/LogoGP.svg"
              width={32}
              height={32}
              alt=""
              role="presentation"
            />
          </Link>
        ) : null}
      </div>

      <div className="min-w-0 flex-1 px-1">
        <h1 className="truncate text-center text-sm font-bold text-dark dark:text-white sm:text-base md:text-lg xl:text-heading-5">
          Girona - Software
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 min-[400px]:gap-2 sm:gap-4">
        <ThemeToggleSwitch />

        <Notification />

        <div className="shrink-0">
          <UserInfo />
        </div>
      </div>
    </header>
  );
}
