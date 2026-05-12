"use client";

import { readAuth } from "@/lib/auth/storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  profile_photo_url: string;
  role: string;
};

type SessionContextValue = {
  me: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<SessionUser | null>;
};

const SessionContext = createContext<SessionContextValue>({
  me: null,
  loading: true,
  refresh: async () => null,
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    const auth = readAuth();
    if (!auth?.accessToken) {
      setMe(null);
      setLoading(false);
      return null;
    }
    const authorization = `${auth.tokenType || "Bearer"} ${auth.accessToken}`;
    const response = await fetch("/api/auth/me", {
      headers: { authorization },
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) {
      setMe(null);
      setLoading(false);
      return null;
    }
    const payload = (await response.json().catch(() => null)) as
      | {
          id?: number;
          email?: string;
          name?: string;
          profile_photo_url?: string;
          role?: string;
        }
      | null;
    if (!payload?.email) {
      setMe(null);
      setLoading(false);
      return null;
    }
    const user: SessionUser = {
      id: Number(payload.id),
      email: payload.email,
      name: payload.name || "Usuario",
      profile_photo_url: payload.profile_photo_url || "/backgrounds/default.jpg",
      role: typeof payload.role === "string" ? payload.role : "mesero",
    };
    setMe(user);
    setLoading(false);
    return user;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ me, loading, refresh }), [me, loading, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
