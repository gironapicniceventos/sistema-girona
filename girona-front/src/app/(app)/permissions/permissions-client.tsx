"use client";

import { readAuth } from "@/lib/auth/storage";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

type StaffUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
};

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "mesero", label: "Mesero" },
  { value: "caja_mesero", label: "Caja + mesero" },
  { value: "jefe_cocina", label: "Jefe de cocina" },
  { value: "gerente", label: "Gerente operativo" },
  { value: "admin", label: "Administrador" },
  { value: "full_access", label: "Dueño (acceso total)" },
];

function authHeader(): string | null {
  const a = readAuth();
  if (!a?.accessToken) return null;
  return `${a.tokenType || "Bearer"} ${a.accessToken}`;
}

/** FastAPI may return `detail` as string or validation error array. */
function formatApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const o = data as { detail?: unknown; message?: unknown };
  if (typeof o.message === "string" && o.message) return o.message;
  const det = o.detail;
  if (typeof det === "string" && det) return det;
  if (Array.isArray(det)) {
    const parts = det.map((x) => {
      if (x && typeof x === "object" && "msg" in x) return String((x as { msg: unknown }).msg);
      return String(x);
    });
    return parts.filter(Boolean).join("; ") || fallback;
  }
  return fallback;
}

export default function PermissionsClient() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [createForm, setCreateForm] = useState({
    email: "",
    full_name: "",
    password: "",
    role: "mesero",
  });

  const [edit, setEdit] = useState<StaffUser | null>(null);
  const [pwdUser, setPwdUser] = useState<StaffUser | null>(null);
  const [newPwd, setNewPwd] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const h = authHeader();
    if (!h) {
      setLoading(false);
      return;
    }
    const res = await fetch("/api/auth/staff/users", {
      headers: { authorization: h },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as StaffUser[] | unknown;
    if (!res.ok) {
      setError(formatApiError(data, "No se pudieron cargar los usuarios"));
      setUsers([]);
    } else if (Array.isArray(data)) {
      setUsers(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const h = authHeader();
    if (!h) return;
    setBusyId(-1);
    const res = await fetch("/api/auth/staff/users", {
      method: "POST",
      headers: { authorization: h, "content-type": "application/json" },
      body: JSON.stringify({
        email: createForm.email.trim(),
        full_name: createForm.full_name.trim(),
        password: createForm.password,
        role: createForm.role,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(formatApiError(j, "No se pudo crear el usuario"));
    } else {
      setCreateForm({ email: "", full_name: "", password: "", role: "mesero" });
      await load();
    }
    setBusyId(null);
  }

  async function patchUser(u: StaffUser) {
    setError(null);
    const h = authHeader();
    if (!h) return;
    setBusyId(u.id);
    const res = await fetch(`/api/auth/staff/users/${u.id}`, {
      method: "PATCH",
      headers: { authorization: h, "content-type": "application/json" },
      body: JSON.stringify({
        full_name: u.name,
        email: u.email,
        role: u.role,
        is_active: u.is_active,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(formatApiError(j, "No se pudo actualizar"));
    } else {
      setEdit(null);
      await load();
    }
    setBusyId(null);
  }

  async function deactivateUser(u: StaffUser) {
    if (!confirm(`¿Desactivar a ${u.name}? No podrá iniciar sesión.`)) return;
    setError(null);
    const h = authHeader();
    if (!h) return;
    setBusyId(u.id);
    const res = await fetch(`/api/auth/staff/users/${u.id}`, { method: "DELETE", headers: { authorization: h } });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(formatApiError(j, "No se pudo desactivar"));
    } else await load();
    setBusyId(null);
  }

  async function submitPassword() {
    if (!pwdUser || newPwd.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    setError(null);
    const h = authHeader();
    if (!h) return;
    setBusyId(pwdUser.id);
    const res = await fetch(`/api/auth/staff/users/${pwdUser.id}/password`, {
      method: "POST",
      headers: { authorization: h, "content-type": "application/json" },
      body: JSON.stringify({ new_password: newPwd }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(formatApiError(j, "No se pudo cambiar la contraseña"));
    } else {
      setPwdUser(null);
      setNewPwd("");
    }
    setBusyId(null);
  }

  if (loading) {
    return <p className="text-sm text-gray-6">Cargando usuarios…</p>;
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-6 dark:text-dark-6">
        Las contraseñas están cifradas: no se pueden ver; solo puedes asignar una nueva.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-stroke bg-white p-5 shadow-sm dark:border-dark-3 dark:bg-gray-dark">
        <h2 className="mb-4 text-lg font-semibold text-dark dark:text-white">Nuevo usuario</h2>
        <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-dark dark:text-white">Correo</span>
            <input
              type="email"
              required
              className="w-full rounded-lg border border-stroke bg-white px-3 py-2 dark:border-dark-3 dark:bg-dark-2"
              value={createForm.email}
              onChange={(e) => setCreateForm((s) => ({ ...s, email: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-dark dark:text-white">Nombre</span>
            <input
              type="text"
              required
              className="w-full rounded-lg border border-stroke bg-white px-3 py-2 dark:border-dark-3 dark:bg-dark-2"
              value={createForm.full_name}
              onChange={(e) => setCreateForm((s) => ({ ...s, full_name: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-dark dark:text-white">Contraseña inicial</span>
            <input
              type="password"
              required
              minLength={6}
              className="w-full rounded-lg border border-stroke bg-white px-3 py-2 dark:border-dark-3 dark:bg-dark-2"
              value={createForm.password}
              onChange={(e) => setCreateForm((s) => ({ ...s, password: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-dark dark:text-white">Rol</span>
            <select
              className="w-full rounded-lg border border-stroke bg-white px-3 py-2 dark:border-dark-3 dark:bg-dark-2"
              value={createForm.role}
              onChange={(e) => setCreateForm((s) => ({ ...s, role: e.target.value }))}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={busyId !== null}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Crear usuario
            </button>
          </div>
        </form>
      </section>

      <div className="overflow-x-auto rounded-xl border border-stroke bg-white shadow-sm dark:border-dark-3 dark:bg-gray-dark">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-stroke bg-gray-2 dark:border-dark-3 dark:bg-dark-2">
            <tr>
              <th className="px-4 py-3 font-semibold">Nombre</th>
              <th className="px-4 py-3 font-semibold">Correo</th>
              <th className="px-4 py-3 font-semibold">Rol</th>
              <th className="px-4 py-3 font-semibold">Activo</th>
              <th className="px-4 py-3 font-semibold">Contraseña</th>
              <th className="px-4 py-3 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-stroke dark:border-dark-3">
                <td className="px-4 py-3">{u.name}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">
                  <code className="rounded bg-gray-2 px-1.5 py-0.5 text-xs dark:bg-dark-2">{u.role}</code>
                </td>
                <td className="px-4 py-3">{u.is_active ? "Sí" : "No"}</td>
                <td className="px-4 py-3 text-gray-6">—</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs font-medium dark:border-dark-4",
                        "hover:bg-gray-2 dark:hover:bg-dark-3",
                      )}
                      onClick={() => setEdit({ ...u })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-primary px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                      onClick={() => {
                        setPwdUser(u);
                        setNewPwd("");
                      }}
                    >
                      Nueva clave
                    </button>
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                      onClick={() => void deactivateUser(u)}
                    >
                      Desactivar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-stroke bg-white p-6 dark:border-dark-3 dark:bg-gray-dark">
            <h3 className="mb-4 text-lg font-semibold text-dark dark:text-white">Editar usuario</h3>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Nombre</span>
                <input
                  className="w-full rounded-lg border border-stroke px-3 py-2 dark:border-dark-3 dark:bg-dark-2"
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Correo</span>
                <input
                  type="email"
                  className="w-full rounded-lg border border-stroke px-3 py-2 dark:border-dark-3 dark:bg-dark-2"
                  value={edit.email}
                  onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Rol</span>
                <select
                  className="w-full rounded-lg border border-stroke px-3 py-2 dark:border-dark-3 dark:bg-dark-2"
                  value={edit.role}
                  onChange={(e) => setEdit({ ...edit, role: e.target.value })}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={edit.is_active}
                  onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })}
                />
                Activo
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="rounded-lg border px-4 py-2 text-sm dark:border-dark-4" onClick={() => setEdit(null)}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                onClick={() => void patchUser(edit)}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {pwdUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog">
          <div className="w-full max-w-md rounded-xl border border-stroke bg-white p-6 dark:border-dark-3 dark:bg-gray-dark">
            <h3 className="mb-2 text-lg font-semibold text-dark dark:text-white">Nueva contraseña</h3>
            <p className="mb-4 text-sm text-gray-6">{pwdUser.email}</p>
            <input
              type="password"
              minLength={6}
              className="mb-4 w-full rounded-lg border border-stroke px-3 py-2 dark:border-dark-3 dark:bg-dark-2"
              placeholder="Mínimo 6 caracteres"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border px-4 py-2 text-sm dark:border-dark-4" onClick={() => setPwdUser(null)}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                onClick={() => void submitPassword()}
              >
                Guardar clave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
