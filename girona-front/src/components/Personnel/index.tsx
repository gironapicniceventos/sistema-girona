"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SearchIcon } from "@/assets/icons";
import { standardFormat } from "@/lib/format-number";

type TabKey = "customers" | "suppliers" | "waiters";

type Supplier = {
  id: number;
  name: string;
  phone?: string | null;
  gender?: string | null;
  is_active: boolean;
  created_at: string;
  ingredient_product_ids?: number[];
  tax_regime?: "common" | "natural" | string;
  income_tax_declarant?: boolean;
  default_withholding_operation?: "purchase" | "service";
  /** Porcentaje nominal (ej. 2.5 = 2,5 %); ausente = tabla legal por declarante */
  default_withholding_percent?: number | string | null;
};

/** Para vista prevía en el proveedor (misma tabla que Inventario compras). */
type SupplierWHOp = "purchase" | "service";

const SUPL_RETE_COMPRA_BASE = 524_000;
const SUPL_RETE_SERVICIO_BASE = 105_000;

function supplierFormDeclarant(regime: "common" | "natural", incomeDecl: boolean): boolean {
  return regime === "natural" ? incomeDecl : true;
}

function supplierFormWithholdingPct(op: SupplierWHOp, declarant: boolean): number {
  if (op === "purchase") return declarant ? 2.5 : 3.5;
  return declarant ? 4 : 6;
}

function supplierFormWHBaseCop(op: SupplierWHOp): number {
  return op === "purchase" ? SUPL_RETE_COMPRA_BASE : SUPL_RETE_SERVICIO_BASE;
}

function supplierFormWHBaseFormatted(op: SupplierWHOp): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(supplierFormWHBaseCop(op));
}

/** Vacío = usar tabla legal; fuera de rango = invalid para validar al guardar */
function parseSupplierPercentField(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number.parseFloat(t.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) return "invalid";
  return n;
}

type SupplierIngredientOption = {
  id: number;
  name: string;
  unit: string | null;
};

const INGREDIENT_UNIT_OPTIONS = [
  { value: "mililitros", label: "ML" },
  { value: "gramos", label: "GR" },
  { value: "unidades", label: "Unidad" },
];

type SupplierIngredientRowState =
  | {
      kind: "existing";
      productId: number | "";
      purchase_quantity: string;
      purchase_total_cost: string;
    }
  | {
      kind: "new";
      name: string;
      unit: string;
      initial_quantity: string;
      total_cost: string;
      sku: string;
    };

function safeNumber(value: unknown) {
  const asNumber = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(asNumber) ? asNumber : null;
}

function normalizeMoneyInput(value: string) {
  return value.replace(/\D/g, "");
}

function formatCopInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const asNumber = Number(digits);
  if (!Number.isFinite(asNumber)) return "";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(asNumber);
}

function computeUnitCost(quantity: unknown, totalCost: unknown) {
  const qty = safeNumber(quantity);
  const total = safeNumber(typeof totalCost === "string" ? totalCost.replace(/\D/g, "") : totalCost);
  if (qty === null || total === null || qty <= 0) return 0;
  return Math.round(total / qty);
}

type Customer = {
  id: number;
  name: string;
  identity_document: string;
  phone?: string | null;
  gender?: string | null;
  is_active: boolean;
  created_at: string;
};

type Waiter = {
  id: number;
  name: string;
  gender?: string | null;
  is_active: boolean;
  created_at: string;
};

type Sale = {
  id: number;
  customer_id: number | null;
  waiter_id: number | null;
  total: number | string;
  created_at: string;
};

type Purchase = {
  id: number;
  supplier_id: number | null;
  purchased_at?: string | null;
  created_at: string;
  total_cost: number | string;
};

type DetailsEntry = {
  id: number;
  date: string;
  total: number;
};

type SubmitStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function tabKeyFromQueryParam(raw: string | null): TabKey | null {
  if (!raw) return null;
  const t = raw.toLowerCase().trim();
  if (t === "suppliers" || t === "proveedores" || t === "proveedor") return "suppliers";
  if (t === "customers" || t === "clientes" || t === "cliente") return "customers";
  if (t === "waiters" || t === "meseros" || t === "mesero") return "waiters";
  return null;
}

function getCardBackground(
  tab: TabKey,
  gender: string | null | undefined,
) {
  const normalized = (gender ?? "male").toLowerCase();
  if (tab === "customers") {
    return normalized === "female" ? "/backgrounds/cliente.png" : "/backgrounds/cliente_2.png";
  }
  if (tab === "waiters") {
    return normalized === "female" ? "/backgrounds/waiter_2.png" : "/backgrounds/mesero.png";
  }
  return "/backgrounds/proveedor.png";
}

export default function Personnel() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TabKey>("customers");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const next = tabKeyFromQueryParam(searchParams.get("tab"));
    if (next) setTab(next);
  }, [searchParams]);
  const [searchTerm, setSearchTerm] = useState("");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>({ kind: "idle" });

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<number | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsName, setDetailsName] = useState("");
  const [detailsEntries, setDetailsEntries] = useState<DetailsEntry[]>([]);
  const [detailsEmptyMessage, setDetailsEmptyMessage] = useState("");
  const [detailsTitle, setDetailsTitle] = useState("");

  const [nameInput, setNameInput] = useState("");
  const [documentInput, setDocumentInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [genderInput, setGenderInput] = useState("male");
  const [supplierTaxRegimeInput, setSupplierTaxRegimeInput] = useState<"common" | "natural">("common");
  const [supplierIncomeTaxDeclarantInput, setSupplierIncomeTaxDeclarantInput] = useState(true);
  const [supplierDefaultWithholdingOp, setSupplierDefaultWithholdingOp] =
    useState<SupplierWHOp>("purchase");
  const [supplierWithholdingPercentInput, setSupplierWithholdingPercentInput] = useState("");

  const supplierRetentionPreview = useMemo(() => {
    const decl = supplierFormDeclarant(supplierTaxRegimeInput, supplierIncomeTaxDeclarantInput);
    const parsed = parseSupplierPercentField(supplierWithholdingPercentInput);
    const invalidCustom = parsed === "invalid";
    const customPct = parsed === "invalid" || parsed === null ? null : parsed;
    const pct =
      customPct !== null
        ? customPct
        : supplierFormWithholdingPct(supplierDefaultWithholdingOp, decl);
    const altPct =
      customPct !== null ? null : supplierFormWithholdingPct(supplierDefaultWithholdingOp, !decl);
    return {
      decl,
      pct,
      altPct,
      baseLabel: supplierFormWHBaseFormatted(supplierDefaultWithholdingOp),
      pctSource: customPct !== null ? ("custom" as const) : ("table" as const),
      invalidCustom,
    };
  }, [
    supplierTaxRegimeInput,
    supplierIncomeTaxDeclarantInput,
    supplierDefaultWithholdingOp,
    supplierWithholdingPercentInput,
  ]);

  const [supplierIngredientCatalog, setSupplierIngredientCatalog] = useState<
    SupplierIngredientOption[]
  >([]);
  const [supplierIngredientCatalogLoading, setSupplierIngredientCatalogLoading] = useState(false);
  const [supplierIngredientRows, setSupplierIngredientRows] = useState<SupplierIngredientRowState[]>([]);

  const [togglingIds, setTogglingIds] = useState<Set<number>>(() => new Set());

  const filteredSuppliers = useMemo(() => {
    const term = normalizeSearchText(searchTerm);
    if (!term) return suppliers;
    return suppliers.filter((supplier) =>
      normalizeSearchText(supplier.name ?? "").includes(term),
    );
  }, [suppliers, searchTerm]);

  const filteredCustomers = useMemo(() => {
    const term = normalizeSearchText(searchTerm);
    if (!term) return customers;
    return customers.filter((customer) =>
      normalizeSearchText(`${customer.name} ${customer.identity_document}`).includes(term),
    );
  }, [customers, searchTerm]);

  const filteredWaiters = useMemo(() => {
    const term = normalizeSearchText(searchTerm);
    if (!term) return waiters;
    return waiters.filter((waiter) =>
      normalizeSearchText(waiter.name ?? "").includes(term),
    );
  }, [waiters, searchTerm]);

  useEffect(() => {
    loadCurrentTab();
  }, [tab]);

  useEffect(() => {
    if (!showForm || tab !== "suppliers") return;
    let cancelled = false;
    setSupplierIngredientCatalogLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams({ kind: "ingredient", active: "true" });
        const response = await fetch(`/api/inventory/products?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!cancelled && response.ok && Array.isArray(payload)) {
          setSupplierIngredientCatalog(
            (payload as { id: number; name: string; unit?: string | null }[]).map((p) => ({
              id: p.id,
              name: p.name,
              unit: p.unit ?? null,
            })),
          );
        }
      } finally {
        if (!cancelled) setSupplierIngredientCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showForm, tab]);

  useEffect(() => {
    setShowForm(false);
    setFormMode("create");
    setEditingId(null);
    resetForm();
    setSubmitStatus({ kind: "idle" });
    closeDetails();
  }, [tab]);

  async function loadCurrentTab() {
    setLoading(true);
    const query = "?active=true";
    try {
      if (tab === "customers") {
        const response = await fetch(`/api/personnel/customers${query}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as any;
        if (!response.ok) {
          throw new Error(
            (typeof payload?.message === "string" && payload.message) ||
              "No se pudo cargar clientes",
          );
        }
        setCustomers(Array.isArray(payload) ? (payload as Customer[]) : []);
      } else if (tab === "suppliers") {
        const response = await fetch(`/api/personnel/suppliers${query}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as any;
        if (!response.ok) {
          throw new Error(
            (typeof payload?.message === "string" && payload.message) ||
              "No se pudo cargar proveedores",
          );
        }
        setSuppliers(Array.isArray(payload) ? (payload as Supplier[]) : []);
      } else {
        const response = await fetch(`/api/personnel/waiters${query}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as any;
        if (!response.ok) {
          throw new Error(
            (typeof payload?.message === "string" && payload.message) ||
              "No se pudo cargar meseros",
          );
        }
        setWaiters(Array.isArray(payload) ? (payload as Waiter[]) : []);
      }
    } catch {
      if (tab === "customers") setCustomers([]);
      if (tab === "suppliers") setSuppliers([]);
      if (tab === "waiters") setWaiters([]);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setNameInput("");
    setDocumentInput("");
    setPhoneInput("");
    setGenderInput("male");
    setSupplierTaxRegimeInput("common");
    setSupplierIncomeTaxDeclarantInput(true);
    setSupplierDefaultWithholdingOp("purchase");
    setSupplierWithholdingPercentInput("");
    setSupplierIngredientRows([]);
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsLoading(false);
    setDetailsError(null);
    setDetailsName("");
    setDetailsEntries([]);
    setDetailsEmptyMessage("");
    setDetailsTitle("");
  }

  function openCreate() {
    resetForm();
    setFormMode("create");
    setEditingId(null);
    setSubmitStatus({ kind: "idle" });
    setShowForm(true);
  }

  function openEdit(target: Supplier | Customer | Waiter) {
    setFormMode("edit");
    setEditingId(target.id);
    setSubmitStatus({ kind: "idle" });
    setShowForm(true);
    setNameInput(target.name ?? "");

    if ("identity_document" in target) {
      setDocumentInput(target.identity_document ?? "");
    } else {
      setDocumentInput("");
    }

    if ("phone" in target) {
      setPhoneInput(target.phone ?? "");
    } else {
      setPhoneInput("");
    }
    setGenderInput(target.gender ?? "male");

    if (tab === "suppliers") {
      const ids = (target as Supplier).ingredient_product_ids ?? [];
      const s = target as Supplier;
      setSupplierTaxRegimeInput(s.tax_regime === "natural" ? "natural" : "common");
      setSupplierIncomeTaxDeclarantInput(Boolean(s.income_tax_declarant ?? true));
      setSupplierDefaultWithholdingOp(
        s.default_withholding_operation === "service" ? "service" : "purchase",
      );
      const wh = s.default_withholding_percent;
      setSupplierWithholdingPercentInput(
        wh !== null && wh !== undefined && String(wh).trim() !== "" ? String(wh) : "",
      );
      setSupplierIngredientRows(
        ids.length
          ? ids.map((id) => ({
              kind: "existing" as const,
              productId: id,
              purchase_quantity: "",
              purchase_total_cost: "",
            }))
          : [],
      );
    } else {
      setSupplierIngredientRows([]);
    }
  }

  function cancelForm() {
    setShowForm(false);
    setFormMode("create");
    setEditingId(null);
    resetForm();
    setSubmitStatus({ kind: "idle" });
  }

  function parseAmount(value: number | string | null | undefined) {
    const parsed = typeof value === "string" ? Number(value) : value ?? 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatAmount(value: number) {
    return standardFormat(value);
  }

  function formatDate(value?: string | null) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("es-CO", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }

  async function openDetails(target: Supplier | Customer | Waiter) {
    const isSupplier = tab === "suppliers";
    const title = isSupplier ? "Compras asociadas" : "Ventas asociadas";
    const emptyMessage =
      tab === "customers"
        ? "No hay ventas asociadas para este cliente."
        : tab === "waiters"
          ? "No hay ventas asociadas para este mesero."
          : "No hay compras asociadas para este proveedor.";

    setDetailsOpen(true);
    setDetailsLoading(true);
    setDetailsError(null);
    setDetailsEntries([]);
    setDetailsName(target.name ?? "");
    setDetailsEmptyMessage(emptyMessage);
    setDetailsTitle(title);

    try {
      if (isSupplier) {
        const response = await fetch("/api/inventory/purchases", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as Purchase[] | null;
        if (!response.ok) {
          throw new Error("No se pudieron cargar compras.");
        }
        const entries =
          Array.isArray(payload) && payload.length > 0
            ? payload
                .filter((purchase) => purchase.supplier_id === target.id)
                .map((purchase) => ({
                  id: purchase.id,
                  date: formatDate(purchase.purchased_at ?? purchase.created_at),
                  total: parseAmount(purchase.total_cost),
                }))
            : [];
        setDetailsEntries(entries);
      } else {
        const response = await fetch("/api/sales", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as Sale[] | null;
        if (!response.ok) {
          throw new Error("No se pudieron cargar ventas.");
        }
        const entries =
          Array.isArray(payload) && payload.length > 0
            ? payload
                .filter((sale) =>
                  tab === "customers"
                    ? sale.customer_id === target.id
                    : sale.waiter_id === target.id,
                )
                .map((sale) => ({
                  id: sale.id,
                  date: formatDate(sale.created_at),
                  total: parseAmount(sale.total),
                }))
            : [];
        setDetailsEntries(entries);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo cargar la informacion.";
      setDetailsError(message);
    } finally {
      setDetailsLoading(false);
    }
  }

  async function handleSave() {
    setSubmitStatus({ kind: "loading" });

    const pendingPurchases: Array<{
      product_id: number;
      quantity: string;
      unit_cost: string;
    }> = [];

    const name = nameInput.trim();
    if (!name) {
      setSubmitStatus({ kind: "error", message: "Nombre es requerido." });
      return;
    }

    if (tab === "customers") {
      const identityDocument = documentInput.trim();
      if (!identityDocument) {
        setSubmitStatus({ kind: "error", message: "Documento es requerido." });
        return;
      }
    }

    const phone = phoneInput.trim();

    const endpoint =
      tab === "customers"
        ? "customers"
        : tab === "suppliers"
          ? "suppliers"
          : "waiters";

    const url =
      formMode === "create"
        ? `/api/personnel/${endpoint}`
        : `/api/personnel/${endpoint}/${editingId}`;

    const payload: Record<string, unknown> = { name };
    if (tab !== "suppliers") {
      payload.gender = genderInput;
    }

    if (tab === "customers") {
      payload.identity_document = documentInput.trim();
      payload.phone = phone ? phone : null;
    }

    if (tab === "suppliers") {
      payload.phone = phone ? phone : null;
      payload.gender = "male";
      payload.tax_regime = supplierTaxRegimeInput;
      payload.income_tax_declarant =
        supplierTaxRegimeInput === "natural" ? supplierIncomeTaxDeclarantInput : true;
      payload.default_withholding_operation = supplierDefaultWithholdingOp;
      const pctField = parseSupplierPercentField(supplierWithholdingPercentInput);
      if (pctField === "invalid") {
        setSubmitStatus({
          kind: "error",
          message: "Porcentaje de retención inválido: usá un número entre 0 y 100, o dejá vacío para la tabla legal.",
        });
        return;
      }
      payload.default_withholding_percent = pctField === null ? null : pctField;
      const resolvedIds: number[] = [];
      for (let i = 0; i < supplierIngredientRows.length; i++) {
        const row = supplierIngredientRows[i];
        if (row.kind === "existing") {
          if (row.productId === "" || !Number.isFinite(row.productId)) {
            setSubmitStatus({
              kind: "error",
              message: `Selecciona un producto en la fila ${
                i + 1
              } o usa "Nuevo producto" y completa los campos.`,
            });
            return;
          }
          resolvedIds.push(row.productId);
          const qStr = row.purchase_quantity.trim();
          const tcRaw = normalizeMoneyInput(row.purchase_total_cost);
          if (qStr === "" && tcRaw === "") {
            continue;
          }
          if (qStr === "" || tcRaw === "") {
            setSubmitStatus({
              kind: "error",
              message: `En la fila ${i + 1} indica cantidad y costo total, o deja ambos vacíos para solo vincular el producto.`,
            });
            return;
          }
          const qNum = safeNumber(qStr);
          const tcNum = safeNumber(tcRaw);
          if (qNum === null || qNum <= 0) {
            setSubmitStatus({
              kind: "error",
              message: `Cantidad inválida en la fila ${i + 1}.`,
            });
            return;
          }
          if (tcNum === null || tcNum < 0) {
            setSubmitStatus({
              kind: "error",
              message: `Costo total inválido en la fila ${i + 1}.`,
            });
            return;
          }
          const unitCostNum = computeUnitCost(qStr, tcRaw);
          pendingPurchases.push({
            product_id: row.productId,
            quantity: qStr,
            unit_cost: String(unitCostNum),
          });
          continue;
        }
        const name = row.name.trim();
        if (!name) {
          setSubmitStatus({
            kind: "error",
            message: `Nombre requerido en el ingrediente nuevo (fila ${i + 1}).`,
          });
          return;
        }
        const unit = row.unit.trim();
        if (!unit) {
          setSubmitStatus({ kind: "error", message: `Unidad requerida en la fila ${i + 1}.` });
          return;
        }
        if (!INGREDIENT_UNIT_OPTIONS.some((o) => o.value === unit)) {
          setSubmitStatus({
            kind: "error",
            message: `La unidad debe ser mililitros, gramos o unidades (fila ${i + 1}).`,
          });
          return;
        }
        const q = row.initial_quantity.trim();
        const totalRaw = normalizeMoneyInput(row.total_cost);
        if (!q || !totalRaw) {
          setSubmitStatus({
            kind: "error",
            message: `Cantidad y costo total son requeridos en la fila ${i + 1}.`,
          });
          return;
        }
        const numQ = safeNumber(q);
        const numTc = safeNumber(totalRaw);
        if (numQ === null || numQ <= 0) {
          setSubmitStatus({
            kind: "error",
            message: `Cantidad inválida en la fila ${i + 1}.`,
          });
          return;
        }
        if (numTc === null || numTc < 0) {
          setSubmitStatus({
            kind: "error",
            message: `Costo total inválido en la fila ${i + 1}.`,
          });
          return;
        }

        let productResponse: Response;
        try {
          productResponse = await fetch("/api/inventory/products", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              kind: "ingredient",
              unit,
              initial_quantity: q,
              total_cost: totalRaw,
              sku: row.sku.trim() || null,
              is_active: true,
            }),
          });
        } catch {
          setSubmitStatus({
            kind: "error",
            message: "No se pudo crear un ingrediente. Verifica el servidor.",
          });
          return;
        }
        const productPayload = (await productResponse.json().catch(() => null)) as {
          id?: number;
          message?: string;
          detail?: unknown;
        } | null;
        if (!productResponse.ok) {
          const msg =
            (typeof productPayload?.message === "string" && productPayload.message) ||
            (typeof productPayload?.detail === "string" && productPayload.detail) ||
            "No se pudo registrar el ingrediente.";
          setSubmitStatus({ kind: "error", message: msg });
          return;
        }
        const newId = productPayload?.id;
        if (typeof newId !== "number" || !Number.isFinite(newId)) {
          setSubmitStatus({ kind: "error", message: "Respuesta inválida al crear ingrediente." });
          return;
        }
        resolvedIds.push(newId);
      }
      payload.ingredient_product_ids = [...new Set(resolvedIds)];
    }

    if (formMode === "create") {
      payload.is_active = true;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: formMode === "create" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      setSubmitStatus({
        kind: "error",
        message: "No se pudo conectar con el backend. Verifica el servidor.",
      });
      return;
    }

    const responsePayload = (await response.json().catch(() => null)) as any;
    if (!response.ok) {
      setSubmitStatus({
        kind: "error",
        message:
          (typeof responsePayload?.message === "string" && responsePayload.message) ||
          "No se pudo guardar el registro.",
      });
      return;
    }

    let purchaseWarning: string | null = null;
    if (tab === "suppliers" && pendingPurchases.length > 0) {
      const supplierIdForPurchase: number | null =
        typeof responsePayload?.id === "number"
          ? responsePayload.id
          : formMode === "edit"
            ? editingId
            : null;
      if (supplierIdForPurchase !== null) {
        try {
          const purchaseResponse = await fetch("/api/inventory/purchases", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              supplier_id: supplierIdForPurchase,
              items: pendingPurchases,
            }),
          });
          if (!purchaseResponse.ok) {
            const purchasePayload = (await purchaseResponse
              .json()
              .catch(() => null)) as { message?: string; detail?: unknown } | null;
            purchaseWarning =
              (typeof purchasePayload?.message === "string" && purchasePayload.message) ||
              (typeof purchasePayload?.detail === "string" && purchasePayload.detail) ||
              "El proveedor se guardó, pero no se pudieron registrar las compras.";
          }
        } catch {
          purchaseWarning =
            "El proveedor se guardó, pero falló la conexión al registrar las compras.";
        }
      } else {
        purchaseWarning =
          "El proveedor se guardó, pero no se pudo identificar su id para registrar las compras.";
      }
    }

    if (purchaseWarning) {
      setSubmitStatus({ kind: "error", message: purchaseWarning });
    } else {
      setSubmitStatus({
        kind: "success",
        message:
          formMode === "create"
            ? "Registro creado correctamente."
            : "Cambios guardados correctamente.",
      });
    }
    setShowForm(false);
    setFormMode("create");
    setEditingId(null);
    resetForm();
    await loadCurrentTab();
  }

  async function toggleActive(nextActive: boolean, targetId: number) {
    if (!nextActive) {
      const ok = window.confirm("¿Estás seguro de que deseas desactivarlo?");
      if (!ok) return;
    }

    setTogglingIds((prev) => new Set(prev).add(targetId));

    const endpoint =
      tab === "customers"
        ? "customers"
        : tab === "suppliers"
          ? "suppliers"
          : "waiters";

    try {
      const response = await fetch(`/api/personnel/${endpoint}/${targetId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: nextActive }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as any;
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "No se pudo actualizar el estado",
        );
      }
      await loadCurrentTab();
    } catch {
      setSubmitStatus({
        kind: "error",
        message: "No se pudo actualizar el estado. Intenta nuevamente.",
      });
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
    }
  }

  const currentSingular =
    tab === "customers" ? "Cliente" : tab === "suppliers" ? "Proveedor" : "Mesero";
  const detailsTotal = detailsEntries.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-dark-3 dark:bg-gray-dark">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-dark dark:text-white">Modulo de personal</h2>
          <p className="text-sm text-body-color dark:text-dark-6">
            Gestiona clientes, proveedores y meseros desde un solo lugar.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-md bg-dark px-4 py-2 text-sm font-medium text-white hover:bg-dark/90 dark:bg-white dark:text-dark dark:hover:bg-white/90"
        >
          Agregar {currentSingular}
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("customers")}
          className={
            tab === "customers"
              ? "rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-white"
              : "rounded-md border border-stroke px-2.5 py-1.5 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
          }
        >
          Clientes
        </button>
        <button
          type="button"
          onClick={() => setTab("suppliers")}
          className={
            tab === "suppliers"
              ? "rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-white"
              : "rounded-md border border-stroke px-2.5 py-1.5 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
          }
        >
          Proveedores
        </button>
        <button
          type="button"
          onClick={() => setTab("waiters")}
          className={
            tab === "waiters"
              ? "rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-white"
              : "rounded-md border border-stroke px-2.5 py-1.5 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
          }
        >
          Meseros
        </button>

        <div className="ml-auto flex flex-wrap gap-2">
          <div className="relative w-full max-w-xs">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar..."
              className="w-full rounded-md border-2 border-primary/40 bg-white py-2 pl-11 pr-3 text-sm text-dark shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-dark-3 dark:bg-gray-dark dark:text-white"
            />
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
          </div>
        </div>
      </div>

      {showForm ? (
        <div className="mt-5 rounded-md border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-dark dark:text-white">
                {formMode === "create" ? "Nuevo" : "Editar"} {currentSingular}
              </h3>
              <p className="text-sm text-body-color dark:text-dark-6">
                {tab === "suppliers"
                  ? "Datos basicos primero; debajo aparece retención en la fuente (% opcional, compra/servicio), régimen y declarante, y luego los ingredientes."
                  : "Completa la informacion basica para este registro."}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelForm}
                className="rounded-md border border-stroke px-4 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitStatus.kind === "loading"}
                onClick={handleSave}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {submitStatus.kind === "loading" ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>

          <div
            className={
              "mt-4 grid gap-3 " +
              (tab === "customers"
                ? "sm:grid-cols-2 lg:grid-cols-4"
                : tab === "suppliers"
                  ? "sm:grid-cols-2"
                  : "sm:grid-cols-2 lg:grid-cols-3")
            }
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                Nombre
              </label>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={tab === "customers" ? "Nombre del cliente" : "Nombre"}
                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
              />
            </div>

            {tab === "customers" ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                  Documento
                </label>
                <input
                  value={documentInput}
                  onChange={(e) => setDocumentInput(e.target.value)}
                  placeholder="Documento de identidad"
                  className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                />
              </div>
            ) : null}

            {tab !== "waiters" ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                  Telefono
                </label>
                <input
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="Telefono"
                  className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                />
              </div>
            ) : null}

            {tab !== "suppliers" ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                  Genero
                </label>
                <select
                  value={genderInput}
                  onChange={(e) => setGenderInput(e.target.value)}
                  className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                >
                  <option value="male">Masculino</option>
                  <option value="female">Femenino</option>
                </select>
              </div>
            ) : null}

          </div>

          {tab === "suppliers" ? (
            <div className="mt-4 rounded-md border-2 border-primary/35 bg-white p-4 shadow-sm dark:border-primary/45 dark:bg-gray-dark">
              <div className="mb-2 text-sm font-semibold text-dark dark:text-white">
                Retención en la fuente (proveedor)
              </div>
              <p className="mb-3 text-xs leading-relaxed text-body-color dark:text-dark-6">
                Indicá el tipo de operación por defecto y, si corresponde, el porcentaje de retención que
                aplica este proveedor. Eso es lo que se precarga al registrar una compra en{" "}
                <span className="font-medium text-dark dark:text-white">Inventario</span>. Si dejás el
                porcentaje vacío, se usan las tasas estándar según régimen y si declara renta.
              </p>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                    Compra de bienes o servicio
                  </label>
                  <select
                    value={supplierDefaultWithholdingOp}
                    onChange={(e) =>
                      setSupplierDefaultWithholdingOp(
                        e.target.value === "service" ? "service" : "purchase",
                      )
                    }
                    className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                  >
                    <option value="purchase">
                      Compra (bienes) — base {supplierFormWHBaseFormatted("purchase")}
                    </option>
                    <option value="service">
                      Servicio — base {supplierFormWHBaseFormatted("service")}
                    </option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                    Porcentaje de retención en la fuente (%)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={supplierWithholdingPercentInput}
                    onChange={(e) => setSupplierWithholdingPercentInput(e.target.value)}
                    placeholder="Ej. 2,5 — vacío = tabla legal"
                    className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                  />
                  {supplierRetentionPreview.invalidCustom ? (
                    <p className="mt-1 text-[11px] text-red">
                      Ingresá un número entre 0 y 100 o dejá vacío.
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-body-color dark:text-dark-6">
                      Opcional. Punto o coma como decimal.
                    </p>
                  )}
                </div>
              </div>
              <div className="mb-4 rounded-md bg-primary/10 px-3 py-3 text-xs dark:bg-primary/20">
                <p className="font-semibold text-dark dark:text-white">
                  Vista previa: si el total de la compra supera {supplierRetentionPreview.baseLabel}, la
                  retención usaría{" "}
                  <span className="text-primary">
                    {supplierRetentionPreview.pct.toLocaleString("es-CO", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 4,
                    })}
                    %
                  </span>
                  {supplierRetentionPreview.pctSource === "custom"
                    ? " (valor que digitaste)."
                    : ` según tabla legal (declarante de renta: ${supplierRetentionPreview.decl ? "sí" : "no"}).`}
                </p>
                {supplierRetentionPreview.pctSource === "table" &&
                supplierRetentionPreview.altPct !== null ? (
                  <p className="mt-2 text-[11px] text-body-color dark:text-dark-6">
                    Si no fuera declarante en esta combinación, la tasa sería{" "}
                    {supplierRetentionPreview.altPct.toLocaleString("es-CO")} %. Cambiá régimen o
                    declaración para ver otro escenario.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                    Tipo de régimen
                  </label>
                  <select
                    value={supplierTaxRegimeInput}
                    onChange={(e) =>
                      setSupplierTaxRegimeInput(
                        e.target.value === "natural" ? "natural" : "common",
                      )
                    }
                    className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                  >
                    <option value="common">Común</option>
                    <option value="natural">Natural</option>
                  </select>
                  <p className="mt-1 text-[11px] text-body-color dark:text-dark-6">
                    Régimen común: se trata como declarante. Persona natural: podés marcar si es
                    declarante de renta.
                  </p>
                </div>
                <div className="flex items-end pb-0.5">
                  <label
                    className={
                      "flex cursor-pointer items-start gap-2 text-sm leading-snug text-dark dark:text-white " +
                      (supplierTaxRegimeInput === "natural" ? "" : "opacity-50 pointer-events-none")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={supplierIncomeTaxDeclarantInput}
                      disabled={supplierTaxRegimeInput !== "natural"}
                      onChange={(e) => setSupplierIncomeTaxDeclarantInput(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-stroke accent-primary disabled:accent-gray-400"
                    />
                    <span>Declarante de renta (solo aplica si el régimen es Natural)</span>
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "suppliers" ? (
            <div className="mt-4 space-y-3 border-t border-stroke pt-4 dark:border-dark-3">
              <div>
                <span className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                  Ingredientes que compras a este proveedor
                </span>
                <p className="text-xs text-body-color dark:text-dark-6">
                  Registra ingredientes nuevos con la misma informacion que en Inventario (stock inicial
                  y costo total). Tambien podes vincular productos que ya existen en el catalogo.
                </p>
              </div>
              {supplierIngredientCatalogLoading ? (
                <p className="text-sm text-body-color dark:text-dark-6">Cargando catalogo…</p>
              ) : (
                <div className="space-y-4">
                  {supplierIngredientRows.map((rowVal, index) => {
                    const taken = new Set<number>();
                    supplierIngredientRows.forEach((v, i) => {
                      if (i === index) return;
                      if (v.kind === "existing" && v.productId !== "" && typeof v.productId === "number") {
                        taken.add(v.productId);
                      }
                    });
                    return (
                      <div
                        key={`supplier-ingredient-row-${index}`}
                        className="space-y-2 rounded-md border border-stroke bg-white p-3 dark:border-dark-3 dark:bg-gray-dark"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-body-color dark:text-dark-6">
                            Fila {index + 1}
                          </span>
                          <div className="ml-auto flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setSupplierIngredientRows((rows) => {
                                  const next = [...rows];
                                  const cur = next[index];
                                  next[index] = {
                                    kind: "existing",
                                    productId: cur.kind === "existing" ? cur.productId : "",
                                    purchase_quantity:
                                      cur.kind === "existing" ? cur.purchase_quantity : "",
                                    purchase_total_cost:
                                      cur.kind === "existing" ? cur.purchase_total_cost : "",
                                  };
                                  return next;
                                })
                              }
                              className={
                                "rounded-md px-2.5 py-1 text-xs font-medium " +
                                (rowVal.kind === "existing"
                                  ? "bg-primary text-white"
                                  : "border border-stroke text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2")
                              }
                            >
                              Del catalogo
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setSupplierIngredientRows((rows) => {
                                  const next = [...rows];
                                  next[index] = {
                                    kind: "new",
                                    name: "",
                                    unit: "gramos",
                                    initial_quantity: "",
                                    total_cost: "",
                                    sku: "",
                                  };
                                  return next;
                                })
                              }
                              className={
                                "rounded-md px-2.5 py-1 text-xs font-medium " +
                                (rowVal.kind === "new"
                                  ? "bg-primary text-white"
                                  : "border border-stroke text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2")
                              }
                            >
                              Nuevo producto
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setSupplierIngredientRows((rows) => rows.filter((_, i) => i !== index))
                              }
                              className="rounded-md border border-stroke px-2.5 py-1 text-xs font-medium text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                            >
                              Quitar
                            </button>
                          </div>
                        </div>
                        {rowVal.kind === "existing" ? (
                          <div className="space-y-3">
                            <select
                              value={rowVal.productId === "" ? "" : String(rowVal.productId)}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setSupplierIngredientRows((rows) => {
                                  const n = [...rows];
                                  const cur = n[index];
                                  n[index] = {
                                    kind: "existing",
                                    productId: raw === "" ? "" : Number(raw),
                                    purchase_quantity:
                                      cur.kind === "existing" ? cur.purchase_quantity : "",
                                    purchase_total_cost:
                                      cur.kind === "existing" ? cur.purchase_total_cost : "",
                                  };
                                  return n;
                                });
                              }}
                              className="w-full min-w-0 max-w-md rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                            >
                              <option value="">Selecciona producto</option>
                              {supplierIngredientCatalog.map((p) => (
                                <option
                                  key={p.id}
                                  value={String(p.id)}
                                  disabled={taken.has(p.id)}
                                >
                                  {p.name}
                                  {p.unit ? ` (${p.unit})` : ""}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-body-color dark:text-dark-6">
                              Opcional: registra una entrada de stock con cantidad y costo (deja
                              vacío si solo quieres vincular el producto al proveedor).
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                                  Cantidad
                                </label>
                                <input
                                  value={rowVal.purchase_quantity}
                                  onChange={(e) =>
                                    setSupplierIngredientRows((rows) => {
                                      const n = [...rows];
                                      const cur = n[index];
                                      if (cur.kind === "existing") {
                                        n[index] = { ...cur, purchase_quantity: e.target.value };
                                      }
                                      return n;
                                    })
                                  }
                                  inputMode="decimal"
                                  placeholder="Cantidad comprada"
                                  className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                                  Costo total
                                </label>
                                <input
                                  value={formatCopInput(rowVal.purchase_total_cost)}
                                  onChange={(e) =>
                                    setSupplierIngredientRows((rows) => {
                                      const n = [...rows];
                                      const cur = n[index];
                                      if (cur.kind === "existing") {
                                        n[index] = {
                                          ...cur,
                                          purchase_total_cost: normalizeMoneyInput(e.target.value),
                                        };
                                      }
                                      return n;
                                    })
                                  }
                                  inputMode="numeric"
                                  placeholder="Ej: 45.000"
                                  className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                                />
                              </div>
                              <div className="flex flex-col justify-end">
                                <span className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                                  Costo unit. (calculado)
                                </span>
                                <div className="flex min-h-[42px] items-center rounded-md border border-stroke bg-gray-1 px-3 text-sm text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white">
                                  {formatCopInput(
                                    String(
                                      computeUnitCost(
                                        rowVal.purchase_quantity,
                                        rowVal.purchase_total_cost,
                                      ),
                                    ),
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                            <div className="min-w-0 sm:col-span-2">
                              <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                                Nombre
                              </label>
                              <input
                                value={rowVal.name}
                                onChange={(e) =>
                                  setSupplierIngredientRows((rows) => {
                                    const n = [...rows];
                                    const cur = n[index];
                                    if (cur.kind === "new") {
                                      n[index] = { ...cur, name: e.target.value };
                                    }
                                    return n;
                                  })
                                }
                                placeholder="Ej: Queso mozzarella"
                                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                                Unidad
                              </label>
                              <select
                                value={rowVal.unit}
                                onChange={(e) =>
                                  setSupplierIngredientRows((rows) => {
                                    const n = [...rows];
                                    const cur = n[index];
                                    if (cur.kind === "new") {
                                      n[index] = { ...cur, unit: e.target.value };
                                    }
                                    return n;
                                  })
                                }
                                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                              >
                                <option value="">Selecciona unidad</option>
                                {INGREDIENT_UNIT_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                                Cantidad
                              </label>
                              <input
                                value={rowVal.initial_quantity}
                                onChange={(e) =>
                                  setSupplierIngredientRows((rows) => {
                                    const n = [...rows];
                                    const cur = n[index];
                                    if (cur.kind === "new") {
                                      n[index] = { ...cur, initial_quantity: e.target.value };
                                    }
                                    return n;
                                  })
                                }
                                inputMode="decimal"
                                placeholder="Stock inicial"
                                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                                Costo total
                              </label>
                              <input
                                value={formatCopInput(rowVal.total_cost)}
                                onChange={(e) =>
                                  setSupplierIngredientRows((rows) => {
                                    const n = [...rows];
                                    const cur = n[index];
                                    if (cur.kind === "new") {
                                      n[index] = {
                                        ...cur,
                                        total_cost: normalizeMoneyInput(e.target.value),
                                      };
                                    }
                                    return n;
                                  })
                                }
                                inputMode="numeric"
                                placeholder="Ej: 45.000"
                                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                                SKU (opcional)
                              </label>
                              <input
                                value={rowVal.sku}
                                onChange={(e) =>
                                  setSupplierIngredientRows((rows) => {
                                    const n = [...rows];
                                    const cur = n[index];
                                    if (cur.kind === "new") {
                                      n[index] = { ...cur, sku: e.target.value };
                                    }
                                    return n;
                                  })
                                }
                                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                              />
                            </div>
                            <div className="flex flex-col justify-end">
                              <span className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                                Costo unit. (calculado)
                              </span>
                              <div className="flex min-h-[42px] items-center rounded-md border border-stroke bg-gray-1 px-3 text-sm text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white">
                                {formatCopInput(String(computeUnitCost(rowVal.initial_quantity, rowVal.total_cost)))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      setSupplierIngredientRows((rows) => [
                        ...rows,
                        {
                          kind: "new" as const,
                          name: "",
                          unit: "gramos",
                          initial_quantity: "",
                          total_cost: "",
                          sku: "",
                        },
                      ])
                    }
                    className="rounded-md border border-stroke px-3 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                  >
                    Agregar producto
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {submitStatus.kind === "error" ? (
            <div className="mt-3 rounded-md border border-red-light bg-red-light-5 px-3 py-2 text-sm text-red dark:border-red-light/40 dark:bg-red-light-5/10 dark:text-red-light">
              {submitStatus.message}
            </div>
          ) : null}
          {submitStatus.kind === "success" ? (
            <div className="mt-3 rounded-md border border-green-light bg-green-light-7 px-3 py-2 text-sm text-green dark:border-green-light/40 dark:bg-green-light-7/10 dark:text-green-light">
              {submitStatus.message}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <div className="rounded-md border border-dashed border-stroke bg-gray-1 px-4 py-6 text-sm text-body-color dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
            Cargando...
          </div>
        ) : tab === "customers" ? (
          filteredCustomers.length === 0 ? (
            <div className="rounded-md border border-dashed border-stroke bg-gray-1 px-4 py-6 text-sm text-body-color dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
              No hay clientes registrados.
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredCustomers.map((customer) => (
                <div
                  key={`customer-${customer.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetails(customer)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openDetails(customer);
                    }
                  }}
                  className="group relative flex min-h-[240px] flex-col justify-between overflow-hidden rounded-2xl border border-stroke bg-gray-2 p-5 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-dark-3"
                  style={{
                    backgroundImage: `url('${getCardBackground("customers", customer.gender)}')`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  <div className="absolute inset-0 bg-black/60" />
                  <div className="relative z-10 space-y-2">
                    <h3 className="text-lg font-extrabold">{customer.name}</h3>
                    <p className="text-md text-white/85 font-semibold">
                      Documento: {customer.identity_document}
                    </p>
                    <p className="text-md text-white/85 font-semibold">Telefono: {customer.phone || "-"}</p>
                    <p
                      className={`text-sm font-semibold ${
                        customer.is_active ? "text-green-200" : "text-red-200"
                      }`}
                    >
                      {customer.is_active ? "Activo" : "Inactivo"}
                    </p>
                  </div>
                  <div className="relative z-10 mt-5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(customer);
                      }}
                      className="rounded-md bg-white/90 px-3 py-2 text-sm font-semibold text-dark transition hover:bg-white"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={togglingIds.has(customer.id)}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleActive(!customer.is_active, customer.id);
                      }}
                      className={
                        customer.is_active
                          ? "rounded-md bg-red/90 px-3 py-2 text-sm font-semibold text-white hover:bg-red"
                          : "rounded-md bg-green/90 px-3 py-2 text-sm font-semibold text-white hover:bg-green"
                      }
                    >
                      {customer.is_active ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : tab === "suppliers" ? (
          filteredSuppliers.length === 0 ? (
            <div className="rounded-md border border-dashed border-stroke bg-gray-1 px-4 py-6 text-sm text-body-color dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
              No hay proveedores registrados.
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredSuppliers.map((supplier) => (
                <div
                  key={`supplier-${supplier.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetails(supplier)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openDetails(supplier);
                    }
                  }}
                  className="group relative flex min-h-[240px] flex-col justify-between overflow-hidden rounded-2xl border border-stroke bg-gray-2 p-5 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-dark-3"
                  style={{
                    backgroundImage: `url('${getCardBackground("suppliers", supplier.gender)}')`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  <div className="absolute inset-0 bg-black/60" />
                  <div className="relative z-10 space-y-2">
                    <h3 className="text-lg font-extrabold">{supplier.name}</h3>
                    <p className="text-md font-semibold text-white/85">Telefono: {supplier.phone || "-"}</p>
                    <p className="text-sm font-medium text-white/80">
                      {supplier.tax_regime === "natural"
                        ? `Natural · ${
                            supplier.income_tax_declarant !== false ? "declarante" : "no declarante"
                          }`
                        : "Regimen común"}
                    </p>
                    <p
                      className={`text-sm font-semibold ${
                        supplier.is_active ? "text-green-200" : "text-red-200"
                      }`}
                    >
                      {supplier.is_active ? "Activo" : "Inactivo"}
                    </p>
                  </div>
                  <div className="relative z-10 mt-5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(supplier);
                      }}
                      className="rounded-md bg-white/90 px-3 py-2 text-sm font-semibold text-dark transition hover:bg-white"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={togglingIds.has(supplier.id)}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleActive(!supplier.is_active, supplier.id);
                      }}
                      className={
                        supplier.is_active
                          ? "rounded-md bg-red/90 px-3 py-2 text-sm font-semibold text-white hover:bg-red"
                          : "rounded-md bg-green/90 px-3 py-2 text-sm font-semibold text-white hover:bg-green"
                      }
                    >
                      {supplier.is_active ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : filteredWaiters.length === 0 ? (
          <div className="rounded-md border border-dashed border-stroke bg-gray-1 px-4 py-6 text-sm text-body-color dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
            No hay meseros registrados.
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filteredWaiters.map((waiter) => (
              <div
                key={`waiter-${waiter.id}`}
                role="button"
                tabIndex={0}
                onClick={() => openDetails(waiter)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDetails(waiter);
                  }
                }}
                className="group relative flex min-h-[240px] flex-col justify-between overflow-hidden rounded-2xl border border-stroke bg-gray-2 p-5 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-dark-3"
                style={{
                  backgroundImage: `url('${getCardBackground("waiters", waiter.gender)}')`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                <div className="absolute inset-0 bg-black/60" />
                <div className="relative z-10 space-y-2">
                  <h3 className="text-lg font-extrabold">{waiter.name}</h3>
                  <p
                    className={`text-sm font-semibold ${
                      waiter.is_active ? "text-green-200" : "text-red-200"
                    }`}
                  >
                    {waiter.is_active ? "Activo" : "Inactivo"}
                  </p>
                </div>
                <div className="relative z-10 mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(waiter);
                    }}
                    className="rounded-md bg-white/90 px-3 py-2 text-sm font-semibold text-dark transition hover:bg-white"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={togglingIds.has(waiter.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleActive(!waiter.is_active, waiter.id);
                    }}
                    className={
                      waiter.is_active
                        ? "rounded-md bg-red/90 px-3 py-2 text-sm font-semibold text-white hover:bg-red"
                        : "rounded-md bg-green/90 px-3 py-2 text-sm font-semibold text-white hover:bg-green"
                    }
                  >
                    {waiter.is_active ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {detailsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 opacity-0 animate-[fadeIn_160ms_ease-out_forwards]"
          role="dialog"
          aria-modal="true"
          onClick={closeDetails}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-stroke bg-white p-5 shadow-2xl opacity-0 animate-[fadeIn_200ms_ease-out_60ms_forwards] dark:border-dark-3 dark:bg-gray-dark"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-dark dark:text-white">
                  {detailsTitle} - {detailsName}
                </h3>
                <p className="text-sm text-body-color dark:text-dark-6">
                  Total: ${formatAmount(detailsTotal)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDetails}
                className="rounded-xl border border-stroke bg-gray-1 px-3 py-2 text-sm font-semibold text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:bg-white/5 dark:text-white"
              >
                Cerrar
              </button>
            </div>

            {detailsLoading ? (
              <div className="rounded-md border border-dashed border-stroke bg-gray-1 px-4 py-6 text-sm text-body-color dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
                Cargando informacion...
              </div>
            ) : detailsError ? (
              <div className="rounded-md border border-red-light bg-red-light-5 px-4 py-3 text-sm text-red dark:border-red-light/40 dark:bg-red-light-5/10 dark:text-red-light">
                {detailsError}
              </div>
            ) : detailsEntries.length === 0 ? (
              <div className="rounded-md border border-dashed border-stroke bg-gray-1 px-4 py-6 text-sm text-body-color dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
                {detailsEmptyMessage}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-auto">
                  <thead>
                    <tr className="bg-gray-2 text-left dark:bg-dark-2">
                      <th className="px-4 py-3 text-xs font-semibold text-dark dark:text-white">
                        ID
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-dark dark:text-white">
                        Fecha
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-dark dark:text-white">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailsEntries.map((entry) => (
                      <tr
                        key={`details-${entry.id}`}
                        className="border-b border-stroke dark:border-dark-3"
                      >
                        <td className="px-4 py-3 text-sm text-dark dark:text-white">
                          #{entry.id}
                        </td>
                        <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                          {entry.date}
                        </td>
                        <td className="px-4 py-3 text-sm text-dark dark:text-white">
                          ${formatAmount(entry.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
