"use client";

import { ChevronUpIcon } from "@/assets/icons";
import {
  Dropdown,
  DropdownContent,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { clearAuth, readAuth } from "@/lib/auth/storage";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOutIcon, UserIcon } from "./icons";

export function UserInfo() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const [user, setUser] = useState({
    name: "Usuario",
    email: "",
    img: "/backgrounds/default.jpg",
  });

  const authHeader = useMemo(() => {
    const auth = readAuth();
    if (!auth?.accessToken) return null;
    return `${auth.tokenType || "Bearer"} ${auth.accessToken}`;
  }, []);

  useEffect(() => {
    async function loadUser() {
      if (!authHeader) return;
      const response = await fetch("/api/auth/me", {
        headers: { authorization: authHeader },
        cache: "no-store",
      }).catch(() => null);
      if (!response || !response.ok) return;
      const payload = (await response.json().catch(() => null)) as
        | {
            email?: string;
            name?: string;
            profile_photo_url?: string;
          }
        | null;
      if (!payload?.email) return;
      setUser({
        name: payload.name || "Usuario",
        email: payload.email,
        img: payload.profile_photo_url || "/backgrounds/default.jpg",
      });
    }
    void loadUser();
  }, [authHeader]);

  const handleLogout = () => {
    clearAuth();
    setIsOpen(false);
    router.push("/auth/sign-in");
  };

  return (
    <Dropdown isOpen={isOpen} setIsOpen={setIsOpen}>
      <DropdownTrigger className="rounded align-middle outline-none ring-primary ring-offset-2 focus-visible:ring-1 dark:ring-offset-gray-dark">
        <span className="sr-only">My Account</span>

        <figure className="flex items-center gap-3">
          <img
            src={user.img}
            className="size-12 rounded-full object-cover"
            alt={`Avatar de ${user.name}`}
            width={48}
            height={48}
          />
          <figcaption className="flex items-center gap-1 font-medium text-dark dark:text-white max-[1024px]:sr-only">
            <span>{user.name}</span>

            <ChevronUpIcon
              aria-hidden
              className={cn(
                "rotate-180 transition-transform",
                isOpen && "rotate-0",
              )}
              strokeWidth={1.5}
            />
          </figcaption>
        </figure>
      </DropdownTrigger>

      <DropdownContent
        className="border border-stroke bg-white shadow-md dark:border-dark-3 dark:bg-gray-dark min-[230px]:min-w-[17.5rem]"
        align="end"
      >
        <h2 className="sr-only">User information</h2>

        <figure className="flex items-center gap-2.5 px-5 py-3.5">
          <img
            src={user.img}
            className="size-12 rounded-full object-cover"
            alt={`Avatar de ${user.name}`}
            width={48}
            height={48}
          />

          <figcaption className="space-y-1 text-base font-medium">
            <div className="mb-2 leading-none text-dark dark:text-white">
              {user.name}
            </div>

            <div className="leading-none text-gray-6">{user.email}</div>
          </figcaption>
        </figure>

        <hr className="border-[#E8E8E8] dark:border-dark-3" />

        <div className="p-2 text-base text-[#4B5563] dark:text-dark-6 [&>*]:cursor-pointer">
          <Link
            href={"/profile"}
            onClick={() => setIsOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-3 dark:hover:text-white"
          >
            <UserIcon />

            <span className="mr-auto text-base font-medium">Ver perfil</span>
          </Link>
        </div>

        <hr className="border-[#E8E8E8] dark:border-dark-3" />

        <div className="p-2 text-base text-[#4B5563] dark:text-dark-6">
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-3 dark:hover:text-white"
            onClick={handleLogout}
          >
            <LogOutIcon />

            <span className="text-base font-medium">Cerrar sesión</span>
          </button>
        </div>
      </DropdownContent>
    </Dropdown>
  );
}
