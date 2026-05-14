"use client";

import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { formatApiErrorMessage } from "@/app/api/personnel/_utils";
import { readAuth } from "@/lib/auth/storage";
import Image from "next/image";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { CameraIcon } from "./_components/icons";

type ProfilePayload = {
  id: number;
  email: string;
  name: string;
  profile_photo_url: string;
};

const DEFAULT_BANNER = "/girona-images/Snapshot_202512356_091270.jpg";
const DEFAULT_PROFILE_PHOTO = "/backgrounds/default.jpg";

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordFields, setPasswordFields] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [data, setData] = useState({
    email: "",
    name: "",
    profilePhoto: DEFAULT_PROFILE_PHOTO,
  });
  /** `id` del usuario actual; sirve como numeración interna del perfil. */
  const [profileUserId, setProfileUserId] = useState<number | null>(null);
  /** Total de cuentas listables vía staff (solo owners suelen verlo; si no, queda null). */
  const [profilesRegisteredCount, setProfilesRegisteredCount] = useState<number | null>(
    null,
  );

  const authHeader = useMemo(() => {
    const auth = readAuth();
    if (!auth?.accessToken) return null;
    return `${auth.tokenType || "Bearer"} ${auth.accessToken}`;
  }, []);

  useEffect(() => {
    async function loadProfile() {
      if (!authHeader) {
        setError("No hay sesión activa.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/auth/me", {
          headers: { authorization: authHeader },
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as
          | ProfilePayload
          | { detail?: string; message?: string }
          | null;

        if (!response.ok || !payload || !("email" in payload)) {
          const message =
            (payload && "detail" in payload && payload.detail) ||
            (payload && "message" in payload && payload.message) ||
            "No se pudo cargar el perfil";
          throw new Error(message);
        }

        setProfileUserId(payload.id);
        setData({
          email: payload.email,
          name: payload.name || "",
          profilePhoto: payload.profile_photo_url || DEFAULT_PROFILE_PHOTO,
        });
      } catch (err) {
        setProfileUserId(null);
        setError(err instanceof Error ? err.message : "Error cargando perfil");
      } finally {
        setLoading(false);
      }
    }

    void loadProfile();
  }, [authHeader]);

  useEffect(() => {
    async function loadProfilesCount() {
      if (!authHeader) {
        setProfilesRegisteredCount(null);
        return;
      }
      try {
        const response = await fetch("/api/auth/staff/users", {
          headers: { authorization: authHeader },
          cache: "no-store",
        });
        if (!response.ok) {
          setProfilesRegisteredCount(null);
          return;
        }
        const list = (await response.json().catch(() => null)) as unknown;
        setProfilesRegisteredCount(Array.isArray(list) ? list.length : null);
      } catch {
        setProfilesRegisteredCount(null);
      }
    }
    void loadProfilesCount();
  }, [authHeader]);

  const onNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setData((prev) => ({ ...prev, name: e.target.value }));
  };

  const onProfilePhotoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) return;
      setData((prev) => ({ ...prev, profilePhoto: result }));
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    const auth = readAuth();
    const dynamicAuthHeader = auth?.accessToken
      ? `${auth.tokenType || "Bearer"} ${auth.accessToken}`
      : null;
    if (!dynamicAuthHeader) {
      setError("No hay sesión activa.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/auth/me", {
        method: "PUT",
        headers: {
          authorization: dynamicAuthHeader,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
          profilePhotoUrl: data.profilePhoto,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | ProfilePayload
        | { detail?: string; message?: string }
        | null;

      if (!response.ok || !payload || !("email" in payload)) {
        const message =
          (payload && "detail" in payload && payload.detail) ||
          (payload && "message" in payload && payload.message) ||
          "No se pudo guardar el perfil";
        throw new Error(message);
      }

      setProfileUserId(payload.id);
      setData((prev) => ({
        ...prev,
        email: payload.email,
        name: payload.name || prev.name,
        profilePhoto: payload.profile_photo_url || prev.profilePhoto,
      }));
      setSuccess("Perfil actualizado correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error guardando perfil");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    const auth = readAuth();
    const dynamicAuthHeader = auth?.accessToken
      ? `${auth.tokenType || "Bearer"} ${auth.accessToken}`
      : null;
    if (!dynamicAuthHeader) {
      setPasswordError("No hay sesión activa.");
      return;
    }

    setPasswordError(null);
    setPasswordSuccess(null);

    if (passwordFields.next.length < 6) {
      setPasswordError("La nueva contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (passwordFields.next !== passwordFields.confirm) {
      setPasswordError("La confirmación no coincide con la nueva contraseña.");
      return;
    }

    setPasswordSaving(true);
    try {
      const response = await fetch("/api/auth/me/password", {
        method: "POST",
        headers: {
          authorization: dynamicAuthHeader,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          currentPassword: passwordFields.current,
          newPassword: passwordFields.next,
        }),
      });

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const msg =
          formatApiErrorMessage(payload) || "No se pudo cambiar la contraseña";
        throw new Error(msg);
      }

      setPasswordFields({ current: "", next: "", confirm: "" });
      setPasswordSuccess("Contraseña actualizada correctamente.");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Error al cambiar contraseña.");
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[970px]">
      <Breadcrumb pageName="Perfil" />

      {!loading && (profileUserId != null || profilesRegisteredCount != null) ? (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-body">
          {profileUserId != null ? (
            <span>
              Tu perfil n.º <strong className="text-dark dark:text-white">{profileUserId}</strong>
            </span>
          ) : null}
          {profilesRegisteredCount != null ? (
            <span>
              Perfiles registrados:{" "}
              <strong className="text-dark dark:text-white">{profilesRegisteredCount}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[10px] bg-white shadow-1 dark:bg-gray-dark dark:shadow-card">
        <div className="relative z-20 h-35 md:h-65">
          <Image
            src={DEFAULT_BANNER}
            alt="profile cover"
            className="h-full w-full rounded-tl-[10px] rounded-tr-[10px] object-cover object-center"
            width={970}
            height={260}
            priority
          />
        </div>

        <div className="px-4 pb-6 text-center lg:pb-8 xl:pb-11.5">
          <div className="relative z-30 mx-auto -mt-22 h-30 w-full max-w-30 rounded-full bg-white/20 p-1 backdrop-blur sm:h-44 sm:max-w-[176px] sm:p-3">
            <div className="relative drop-shadow-2">
              <img
                src={data.profilePhoto || DEFAULT_PROFILE_PHOTO}
                width={160}
                height={160}
                className="overflow-hidden rounded-full object-cover"
                alt="profile"
              />

              <label
                htmlFor="profilePhoto"
                className="absolute bottom-0 right-0 flex size-8.5 cursor-pointer items-center justify-center rounded-full bg-primary text-white hover:bg-opacity-90 sm:bottom-2 sm:right-2"
              >
                <CameraIcon />

                <input
                  type="file"
                  name="profilePhoto"
                  id="profilePhoto"
                  className="sr-only"
                  onChange={onProfilePhotoChange}
                  accept="image/png, image/jpg, image/jpeg"
                />
              </label>
            </div>
          </div>

          <div className="mx-auto mt-6 max-w-xl text-left">
            {error ? (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {success}
              </div>
            ) : null}

            <div className="grid gap-4">
              <label className="text-sm font-medium text-dark dark:text-white">
                Correo
                <input
                  type="email"
                  value={data.email}
                  disabled
                  className="mt-1.5 w-full rounded-lg border border-stroke bg-gray-1 px-3 py-2 text-dark outline-none disabled:cursor-not-allowed dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                />
              </label>

              <label className="text-sm font-medium text-dark dark:text-white">
                Nombre
                <input
                  type="text"
                  value={data.name}
                  onChange={onNameChange}
                  className="mt-1.5 w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                />
              </label>

              <button
                type="button"
                onClick={saveProfile}
                disabled={loading || saving}
                className="inline-flex w-fit items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Guardando..." : "Guardar perfil"}
              </button>
            </div>

            <div className="mt-10 border-t border-stroke pt-8 dark:border-dark-3">
              <h3 className="mb-4 text-base font-semibold text-dark dark:text-white">
                Cambiar contraseña
              </h3>
              {passwordError ? (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                  {passwordError}
                </div>
              ) : null}
              {passwordSuccess ? (
                <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
                  {passwordSuccess}
                </div>
              ) : null}
              <div className="grid gap-4">
                <label className="text-sm font-medium text-dark dark:text-white">
                  Contraseña actual
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={passwordFields.current}
                    onChange={(e) =>
                      setPasswordFields((p) => ({ ...p, current: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                  />
                </label>
                <label className="text-sm font-medium text-dark dark:text-white">
                  Nueva contraseña (mín. 6 caracteres)
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={passwordFields.next}
                    onChange={(e) =>
                      setPasswordFields((p) => ({ ...p, next: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                  />
                </label>
                <label className="text-sm font-medium text-dark dark:text-white">
                  Confirmar nueva contraseña
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={passwordFields.confirm}
                    onChange={(e) =>
                      setPasswordFields((p) => ({ ...p, confirm: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                  />
                </label>
                <button
                  type="button"
                  onClick={changePassword}
                  disabled={passwordSaving || loading}
                  className="inline-flex w-fit items-center rounded-lg border border-stroke bg-white px-4 py-2 text-sm font-medium text-dark hover:bg-gray-1 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:hover:bg-dark-3"
                >
                  {passwordSaving ? "Guardando..." : "Actualizar contraseña"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
