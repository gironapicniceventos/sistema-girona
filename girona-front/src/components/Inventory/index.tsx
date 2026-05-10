"use client";

import type { KeyboardEvent } from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { SearchIcon } from "@/assets/icons";

type InventoryKind = "ingredient" | "material" | "recipe";

type InventoryProduct = {
  id: number;
  name: string;
  sku?: string | null;
  kind: string;
  unit?: string | null;
  on_hand: string;
  average_cost: string;
  last_cost: string;
  is_active: boolean;
  created_at: string;
};

type RecipeItem = {
  id: number;
  menu_item_id: number;
  name: string;
  yield_quantity: string;
  unit?: string | null;
  created_at: string;
  ingredients: Array<{
    name: string;
    unit: string | null;
    quantity: string;
  }>;
};

type PurchaseWithholdingOp = "purchase" | "service";

type Supplier = {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  tax_regime?: string;
  income_tax_declarant?: boolean;
  default_withholding_operation?: PurchaseWithholdingOp | string;
  /** Porcentaje nominal configurado en el proveedor; ausente = tabla legal por declarante */
  default_withholding_percent?: number | string | null;
};

const RETE_FUENTE_BASE_COMPRA = 524_000;
const RETE_FUENTE_BASE_SERVICIO = 105_000;

function effectiveIncomeTaxDeclarantPerson(
  regime: string | undefined,
  incomeTaxDeclarant: boolean | undefined,
) {
  const r = (regime || "common").toLowerCase();
  if (r === "natural") return !!incomeTaxDeclarant;
  return true;
}

function withholdingFraction(op: PurchaseWithholdingOp, declarant: boolean) {
  if (op === "purchase") return declarant ? 0.025 : 0.035;
  return declarant ? 0.04 : 0.06;
}

function parseSupplierStoredPercent(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n =
    typeof raw === "number" ? raw : Number.parseFloat(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

function withholdingPreviewPurchase(
  totalCop: number,
  op: PurchaseWithholdingOp,
  declarant: boolean,
  customPercent: number | null,
): { basis: number; rateFrac: number; amount: number; source: "custom" | "table" } | null {
  const basis = op === "purchase" ? RETE_FUENTE_BASE_COMPRA : RETE_FUENTE_BASE_SERVICIO;
  if (!(Number.isFinite(totalCop) && totalCop >= basis)) return null;
  if (customPercent !== null) {
    const rateFrac = customPercent / 100;
    return {
      basis,
      rateFrac,
      amount: Math.round(totalCop * rateFrac),
      source: "custom",
    };
  }
  const rateFrac = withholdingFraction(op, declarant);
  return {
    basis,
    rateFrac,
    amount: Math.round(totalCop * rateFrac),
    source: "table",
  };
}

type PurchaseItemRow = {
  /** Otros: egreso con descripcion, no altera productos ni stock de inventario */
  mode: "existing" | "new" | "other";
  product_id: string;
  product_name: string;
  unit: string;
  supplier_id: string;
  quantity: string;
  total_cost: string;
  /** Fracción IVA 0–1 sobre (cantidad × costo unitario neto). */
  iva_rate: string;
};

type RecipeIngredientRow = {
  name: string;
  unit: string;
  quantity: string;
  productId: number | null;
};
const UNIT_OPTIONS = [
  { value: "mililitros", label: "ML" },
  { value: "gramos", label: "GR" },
  { value: "unidades", label: "Unidad" },
];

const RECIPE_UNIT_OPTIONS = [
  { value: "", label: "Sin unidad" },
  { value: "GR", label: "GR" },
  { value: "ML", label: "ML" },
  { value: "UND", label: "Unidad" },
];

function safeNumber(value: unknown) {
  const asNumber = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(asNumber) ? asNumber : null;
}

function formatQty(value: unknown) {
  const asNumber = safeNumber(value);
  if (asNumber === null) return String(value ?? "");
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  }).format(asNumber);
}

function formatQtyPlain(value: unknown) {
  const asNumber = safeNumber(value);
  if (asNumber === null) return String(value ?? "");
  return String(Math.round(asNumber));
}

/** Ingredientes solo en texto (recetario bar) vienen con cantidad 0 y sin unidad ML/GR. */
function formatRecipeCatalogIngredientBadge(ingredient: {
  quantity: string;
  unit: string | null;
}): string {
  const unitAbbr = formatUnitAbbr(ingredient.unit);
  const qtyNum = safeNumber(ingredient.quantity);
  if (!unitAbbr && (qtyNum === null || qtyNum === 0)) {
    return "Texto";
  }
  return `${formatQtyPlain(ingredient.quantity)} ${unitAbbr}`.trim();
}

function normalizeIntegerInput(value: string | number | null | undefined) {
  const asNumber = safeNumber(value);
  if (asNumber === null) return "";
  return String(Math.round(asNumber));
}

function formatCop(value: unknown) {
  const asNumber = safeNumber(value);
  if (asNumber === null) return String(value ?? "");
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(asNumber);
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
  const total = safeNumber(totalCost);
  if (qty === null || total === null || qty <= 0) return 0;
  return Math.round(total / qty);
}

function normalizeMoneyInput(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeRecipeIngredientName(value: string) {
  return normalizeSearchText(value);
}

function defaultRecipeUnitForName(name: string) {
  if (normalizeRecipeIngredientName(name) === "salsa tartara") return "ML";
  return "";
}

function normalizeUnitValue(value: string | null | undefined) {
  const raw = (value ?? "").trim().toUpperCase();
  if (raw === "ML" || raw === "MILILITROS") return "mililitros";
  if (raw === "GR" || raw === "GRAMOS") return "gramos";
  if (raw === "UND" || raw === "UNIDADES") return "unidades";
  return value ?? "";
}

function formatUnitAbbr(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  const unit = raw.toLowerCase();
  if (unit === "mililitros") return "ML";
  if (unit === "gramos") return "GR";
  if (unit === "unidades") return "Unidad";
  if (raw.toUpperCase() === "ML") return "ML";
  if (raw.toUpperCase() === "GR") return "GR";
  if (raw.toUpperCase() === "UND") return "Unidad";
  return raw ? raw.toUpperCase() : "";
}

function productUnitToRecipeAbbrev(product: InventoryProduct): string {
  const u = (product.unit ?? "").toString().toLowerCase();
  if (u === "gramos") return "GR";
  if (u === "mililitros") return "ML";
  if (u === "unidades") return "UND";
  return "";
}

async function fetchIngredientProductList(): Promise<InventoryProduct[]> {
  const params = new URLSearchParams({
    kind: "ingredient",
    sort: "supplier_linked",
  });
  const response = await fetch(`/api/inventory/products?${params.toString()}`, {
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || !Array.isArray(payload)) {
    return [];
  }
  return payload as InventoryProduct[];
}

function IngredientSearchField({
  name,
  productId,
  options,
  loading,
  onSelectProduct,
  onNameChange,
}: {
  name: string;
  productId: number | null;
  options: InventoryProduct[];
  loading?: boolean;
  onSelectProduct: (p: InventoryProduct) => void;
  onNameChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const t = normalizeSearchText(name);
    if (!t) return options;
    return options.filter((p) => normalizeSearchText(p.name).includes(t));
  }, [options, name]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlight(0);
    }
  }, [open, name, filtered.length]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!open && (e.key === "ArrowDown" || e.key === "Enter") && options.length) {
        setOpen(true);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === "Enter" && filtered[highlight]) {
        e.preventDefault();
        onSelectProduct(filtered[highlight]);
        setOpen(false);
      }
    },
    [open, options.length, filtered, highlight, onSelectProduct],
  );

  const selectedLabel =
    productId != null
      ? options.find((p) => p.id === productId)?.name
      : null;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <div className="flex items-center gap-1">
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={name}
          onChange={(e) => {
            onNameChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          disabled={!!loading}
          placeholder="Buscar ingrediente..."
          className={
            "w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white " +
            (productId != null
              ? "ring-1 ring-primary/40 dark:ring-primary/50"
              : "")
          }
        />
        {productId != null && selectedLabel ? (
          <span
            className="shrink-0 select-none rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary"
            title="Vinculado al inventario de ingredientes"
          >
            ok
          </span>
        ) : null}
      </div>
      {open && !loading && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-48 w-full min-w-[12rem] overflow-auto rounded-md border border-stroke bg-white py-1 text-sm shadow-md dark:border-dark-3 dark:bg-gray-dark"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-body-color dark:text-dark-6">
              Sin coincidencias. Podés seguir escribiendo un nombre manualmente.
            </li>
          ) : (
            filtered.map((p, idx) => (
              <li
                key={p.id}
                role="option"
                aria-selected={productId === p.id}
                className={
                  "cursor-pointer px-3 py-2 " +
                  (idx === highlight
                    ? "bg-primary/10 text-dark dark:text-white"
                    : "hover:bg-gray-1 dark:hover:bg-dark-2") +
                  (productId === p.id ? " font-semibold" : "")
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectProduct(p);
                  setOpen(false);
                }}
              >
                {p.name}
                {p.unit ? (
                  <span className="ml-1 text-xs text-body-color">({formatUnitAbbr(p.unit)})</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export default function Inventory() {
  const [tab, setTab] = useState<InventoryKind>("ingredient");
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ingredientCache, setIngredientCache] = useState<InventoryProduct[]>([]);
  const [ingredientCacheLoading, setIngredientCacheLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [showRecipeCreate, setShowRecipeCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [recipeNameInput, setRecipeNameInput] = useState("");
  const [recipeYieldInput, setRecipeYieldInput] = useState("1");
  const [recipeUnitInput, setRecipeUnitInput] = useState("");
  const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredientRow[]>([
    { name: "", unit: "", quantity: "", productId: null },
  ]);
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);
  const [unitInput, setUnitInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [totalCostInput, setTotalCostInput] = useState("");
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItemRow[]>([
    {
      mode: "existing",
      product_id: "",
      product_name: "",
      unit: "gramos",
      supplier_id: "",
      quantity: "",
      total_cost: "",
      iva_rate: "0.19",
    },
  ]);
  const [purchaseWithholdingOp, setPurchaseWithholdingOp] =
    useState<PurchaseWithholdingOp>("purchase");
  const purchaseSupplierHoldSyncRef = useRef<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [submitStatus, setSubmitStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [deletingIds, setDeletingIds] = useState<Set<number>>(() => new Set());

  async function loadProducts(kind: InventoryKind) {
    setLoading(true);
    try {
      const response = await fetch(`/api/inventory/products?kind=${encodeURIComponent(kind)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "No se pudo cargar inventario",
        );
      }
      const list = Array.isArray(payload) ? (payload as InventoryProduct[]) : [];
      setProducts(list);
      if (kind === "ingredient") {
        setIngredientCache(list);
      }
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecipes() {
    setLoading(true);
    try {
      const response = await fetch("/api/inventory/recipes", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "No se pudo cargar recetas",
        );
      }
      setRecipes(Array.isArray(payload) ? (payload as RecipeItem[]) : []);
    } catch {
      setRecipes([]);
    } finally {
      setLoading(false);
    }
  }

  async function refreshIngredientCache() {
    setIngredientCacheLoading(true);
    try {
      const list = await fetchIngredientProductList();
      setIngredientCache(list);
    } finally {
      setIngredientCacheLoading(false);
    }
  }

  async function loadSuppliers() {
    try {
      const response = await fetch("/api/inventory/suppliers", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "No se pudo cargar proveedores",
        );
      }
      setSuppliers(Array.isArray(payload) ? (payload as Supplier[]) : []);
    } catch {
      setSuppliers([]);
    }
  }

  useEffect(() => {
    if (tab === "recipe") {
      loadRecipes();
    } else {
      loadProducts(tab);
    }
  }, [tab]);

  useEffect(() => {
    if (tab !== "recipe") {
      loadSuppliers();
    }
  }, [tab]);

  useEffect(() => {
    setShowCreate(false);
    setShowEdit(false);
    setShowRecipeCreate(false);
    setEditingId(null);
    setSubmitStatus({ kind: "idle" });
    resetPurchaseForm();
  }, [tab]);

  const viewTitle =
    tab === "ingredient"
      ? "Inventario de ingredientes"
      : tab === "material"
        ? "Inventario mobiliario"
        : "Inventario de recetas";
  const viewHint =
    tab === "ingredient"
      ? "Ingredientes y productos usados en recetas."
      : tab === "material"
        ? "Mobiliario y equipamiento. Al registrar una compra, cada linea queda asociada al producto y al proveedor indicado (mismo criterio que ingredientes)."
        : "Recetas registradas en el sistema.";

  const lowStockIds = useMemo(() => {
    return new Set<number>();
  }, [products]);

  const filteredProducts = useMemo(() => {
    const term = normalizeSearchText(searchTerm);
    if (!term) return products;
    return products.filter((product) =>
      normalizeSearchText(String(product.name ?? "")).includes(term),
    );
  }, [products, searchTerm]);

  const filteredRecipes = useMemo(() => {
    const term = normalizeSearchText(searchTerm);
    if (!term) return recipes;
    return recipes.filter((recipe) =>
      normalizeSearchText(String(recipe.name ?? "")).includes(term),
    );
  }, [recipes, searchTerm]);

  const purchaseSubtotalCop = useMemo(() => {
    let sum = 0;
    for (const row of purchaseItems) {
      const digits = normalizeMoneyInput(row.total_cost);
      const line = safeNumber(digits);
      if (line !== null && line > 0) sum += line;
    }
    return Math.round(sum);
  }, [purchaseItems]);

  const purchaseSupplierIdsDistinct = useMemo(() => {
    const ids = new Set<number>();
    for (const row of purchaseItems) {
      const raw = row.supplier_id.trim();
      if (!raw) continue;
      const id = Number(raw);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
    return [...ids];
  }, [purchaseItems]);

  const purchaseWithholdingInfo = useMemo(() => {
    if (purchaseSupplierIdsDistinct.length === 0) {
      return { status: "no_supplier" as const };
    }
    if (purchaseSupplierIdsDistinct.length > 1) {
      return { status: "multi_supplier" as const };
    }
    const supplier = suppliers.find((s) => s.id === purchaseSupplierIdsDistinct[0]);
    if (!supplier) {
      return { status: "unknown_supplier" as const };
    }
    const declarant = effectiveIncomeTaxDeclarantPerson(
      supplier.tax_regime,
      supplier.income_tax_declarant,
    );
    const basis =
      purchaseWithholdingOp === "purchase" ? RETE_FUENTE_BASE_COMPRA : RETE_FUENTE_BASE_SERVICIO;
    const customPct = parseSupplierStoredPercent(supplier.default_withholding_percent);
    const applied = withholdingPreviewPurchase(
      purchaseSubtotalCop,
      purchaseWithholdingOp,
      declarant,
      customPct,
    );
    return {
      status: "ok" as const,
      supplier,
      declarant,
      basis,
      applied,
      customPercent: customPct,
      baseLabel:
        purchaseWithholdingOp === "purchase"
          ? "Compra"
          : "Servicio",
    };
  }, [
    suppliers,
    purchaseSupplierIdsDistinct,
    purchaseSubtotalCop,
    purchaseWithholdingOp,
  ]);

  useEffect(() => {
    if (purchaseSupplierIdsDistinct.length !== 1) {
      purchaseSupplierHoldSyncRef.current = null;
      return;
    }
    const sid = purchaseSupplierIdsDistinct[0];
    const supplier = suppliers.find((s) => s.id === sid);
    if (!supplier) return;
    if (purchaseSupplierHoldSyncRef.current === sid) return;
    purchaseSupplierHoldSyncRef.current = sid;
    const pref = supplier.default_withholding_operation;
    if (pref === "service") setPurchaseWithholdingOp("service");
    else setPurchaseWithholdingOp("purchase");
  }, [purchaseSupplierIdsDistinct, suppliers]);

  function resetForm() {
    setNameInput("");
    setUnitInput("");
    setQuantityInput("");
    setTotalCostInput("");
    setRecipeNameInput("");
    setRecipeYieldInput("1");
    setRecipeUnitInput("");
    setRecipeIngredients([{ name: "", unit: "", quantity: "", productId: null }]);
    setEditingRecipeId(null);
  }

  function resetPurchaseForm() {
    const defaultUnit = tab === "ingredient" ? "gramos" : "";
    purchaseSupplierHoldSyncRef.current = null;
    setPurchaseWithholdingOp("purchase");
    setPurchaseItems([
      {
        mode: "existing",
        product_id: "",
        product_name: "",
        unit: defaultUnit,
        supplier_id: "",
        quantity: "",
        total_cost: "",
        iva_rate: "0.19",
      },
    ]);
  }

  function openCreate() {
    setSubmitStatus({ kind: "idle" });
    setShowEdit(false);
    setShowRecipeCreate(false);
    setEditingId(null);
    resetForm();
    resetPurchaseForm();
    setShowCreate(true);
  }

  function openRecipeCreate() {
    setSubmitStatus({ kind: "idle" });
    setShowEdit(false);
    setShowCreate(false);
    setEditingId(null);
    setEditingRecipeId(null);
    resetForm();
    setShowRecipeCreate(true);
    void refreshIngredientCache();
  }

  function openEdit(product: InventoryProduct) {
    setSubmitStatus({ kind: "idle" });
    setShowCreate(false);
    setShowRecipeCreate(false);
    setShowEdit(true);
    setEditingId(product.id);
    setNameInput(product.name ?? "");
    setUnitInput(product.unit ?? "");
    setQuantityInput(formatQty(product.on_hand ?? ""));
    const avg = safeNumber(product.average_cost);
    const qty = safeNumber(product.on_hand);
    const approxTotal = avg !== null && qty !== null ? avg * qty : null;
    setTotalCostInput(
      approxTotal !== null ? String(Math.round(approxTotal)) : "",
    );
  }

  function addRecipeIngredientRow() {
    setRecipeIngredients((prev) => [
      ...prev,
      { name: "", unit: "", quantity: "", productId: null },
    ]);
  }

  function updateRecipeIngredient(
    index: number,
    field: "name" | "unit" | "quantity",
    value: string,
  ) {
    setRecipeIngredients((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        if (field === "name") {
          return { ...item, name: value, productId: null };
        }
        return { ...item, [field]: value };
      }),
    );
  }

  function selectRecipeIngredientProduct(index: number, product: InventoryProduct) {
    setRecipeIngredients((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const u = productUnitToRecipeAbbrev(product) || defaultRecipeUnitForName(product.name);
        return {
          name: product.name,
          productId: product.id,
          unit: u || item.unit,
          quantity: item.quantity,
        };
      }),
    );
  }

  function removeRecipeIngredientRow(index: number) {
    setRecipeIngredients((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== index);
    });
  }

  function addPurchaseRow() {
    const defaultUnit = tab === "ingredient" ? "gramos" : "";
    setPurchaseItems((prev) => [
      ...prev,
      {
        mode: "existing",
        product_id: "",
        product_name: "",
        unit: defaultUnit,
        supplier_id: "",
        quantity: "",
        total_cost: "",
        iva_rate: "0.19",
      },
    ]);
  }

  function updatePurchaseRow(
    index: number,
    field: keyof PurchaseItemRow,
    value: string,
  ) {
    setPurchaseItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)),
    );
  }

  function removePurchaseRow(index: number) {
    setPurchaseItems((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== index);
    });
  }

  function openRecipeEdit(recipe: RecipeItem) {
    setSubmitStatus({ kind: "idle" });
    setShowCreate(false);
    setShowEdit(false);
    setShowRecipeCreate(false);
    setEditingRecipeId(recipe.id);
    setRecipeNameInput(recipe.name ?? "");
    setRecipeYieldInput(normalizeIntegerInput(recipe.yield_quantity ?? "1"));
    setRecipeUnitInput(formatUnitAbbr(recipe.unit) || "");
    if (recipe.ingredients?.length) {
      setRecipeIngredients(
        recipe.ingredients.map((item) => ({
          name: item.name ?? "",
          unit: formatUnitAbbr(item.unit) || defaultRecipeUnitForName(item.name ?? ""),
          quantity: normalizeIntegerInput(item.quantity ?? ""),
          productId: null,
        })),
      );
    } else {
      setRecipeIngredients([{ name: "", unit: "", quantity: "", productId: null }]);
    }
    void (async () => {
      setIngredientCacheLoading(true);
      try {
        const list = await fetchIngredientProductList();
        setIngredientCache(list);
        setRecipeIngredients((rows) =>
          rows.map((row) => {
            const found = list.find(
              (p) => p.name.trim().toLowerCase() === row.name.trim().toLowerCase(),
            );
            return found ? { ...row, productId: found.id } : row;
          }),
        );
      } finally {
        setIngredientCacheLoading(false);
      }
    })();
  }

  function cancelRecipeEdit() {
    setEditingRecipeId(null);
    setSubmitStatus({ kind: "idle" });
    resetForm();
  }

  async function handleCreatePurchase() {
    setSubmitStatus({ kind: "loading" });

    if (!purchaseItems.length) {
      setSubmitStatus({ kind: "error", message: "Debes agregar al menos un producto." });
      return;
    }

    const itemsPayload: Array<{
      is_other_expense?: boolean;
      product_id?: number;
      product_name?: string;
      product_kind?: "ingredient" | "material";
      unit?: string;
      supplier_id?: number | null;
      quantity: string;
      unit_cost: string;
      iva_rate?: number;
    }> = [];

    for (let index = 0; index < purchaseItems.length; index += 1) {
      const row = purchaseItems[index];
      if (row.mode === "other") {
        const productName = row.product_name.trim();
        if (!productName) {
          setSubmitStatus({
            kind: "error",
            message: `Descripcion requerida (Otros) en la fila ${index + 1}.`,
          });
          return;
        }
      } else if (row.mode === "existing") {
        const productId = Number(row.product_id);
        if (!Number.isFinite(productId) || productId <= 0) {
          setSubmitStatus({
            kind: "error",
            message: `Selecciona un producto en la fila ${index + 1}.`,
          });
          return;
        }
      } else {
        const productName = row.product_name.trim();
        if (!productName) {
          setSubmitStatus({
            kind: "error",
            message: `Nombre requerido en la fila ${index + 1}.`,
          });
          return;
        }
        if (tab === "ingredient") {
          const unit = row.unit.trim();
          if (!unit) {
            setSubmitStatus({
              kind: "error",
              message: `Unidad requerida en la fila ${index + 1}.`,
            });
            return;
          }
        }
      }

      const supplierIdRaw = row.supplier_id.trim();
      let supplierId: number | null = null;
      if (supplierIdRaw !== "") {
        const parsedSupplierId = Number(supplierIdRaw);
        if (!Number.isFinite(parsedSupplierId) || parsedSupplierId <= 0) {
          setSubmitStatus({
            kind: "error",
            message: `Proveedor invalido en la fila ${index + 1}.`,
          });
          return;
        }
        supplierId = parsedSupplierId;
      }

      const quantity = row.quantity.trim();
      const totalCostRaw = row.total_cost.trim();
      const quantityValue = safeNumber(quantity);
      const totalCostValue = safeNumber(totalCostRaw);

      if (!quantity || quantityValue === null || quantityValue <= 0) {
        setSubmitStatus({
          kind: "error",
          message: `Cantidad invalida en la fila ${index + 1}.`,
        });
        return;
      }

      if (!totalCostRaw || totalCostValue === null || totalCostValue <= 0) {
        setSubmitStatus({
          kind: "error",
          message: `Costo total invalido en la fila ${index + 1}.`,
        });
        return;
      }

      const unitCost = computeUnitCost(quantityValue, totalCostValue);
      if (unitCost <= 0) {
        setSubmitStatus({
          kind: "error",
          message: `Costo unitario invalido en la fila ${index + 1}.`,
        });
        return;
      }

      const ivaFrac = Number.parseFloat(row.iva_rate || "0");
      const iva_rate = Math.min(1, Math.max(0, Number.isFinite(ivaFrac) ? ivaFrac : 0));

      if (row.mode === "other") {
        itemsPayload.push({
          is_other_expense: true,
          product_name: row.product_name.trim(),
          supplier_id: supplierId,
          quantity,
          unit_cost: String(unitCost),
          iva_rate,
        });
      } else if (row.mode === "existing") {
        itemsPayload.push({
          product_id: Number(row.product_id),
          supplier_id: supplierId,
          quantity,
          unit_cost: String(unitCost),
          iva_rate,
        });
      } else {
        itemsPayload.push({
          product_name: row.product_name.trim(),
          product_kind: tab === "ingredient" ? "ingredient" : "material",
          unit: tab === "ingredient" ? row.unit.trim() : undefined,
          supplier_id: supplierId,
          quantity,
          unit_cost: String(unitCost),
          iva_rate,
        });
      }
    }

    try {
      const response = await fetch("/api/inventory/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          supplier_id:
            purchaseSupplierIdsDistinct.length === 1
              ? purchaseSupplierIdsDistinct[0]
              : null,
          withholding_operation_type: purchaseWithholdingOp,
          items: itemsPayload,
        }),
      });

      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        setSubmitStatus({
          kind: "error",
          message:
            (typeof payload?.message === "string" && payload.message) ||
            "No se pudo registrar la compra.",
        });
        return;
      }

      setSubmitStatus({ kind: "success", message: "Compra registrada." });
      resetPurchaseForm();
      loadProducts(tab);
    } catch {
      setSubmitStatus({
        kind: "error",
        message: "Error registrando la compra (revisa conexion al backend).",
      });
    }
  }

  async function handleCreateRecipe() {
    setSubmitStatus({ kind: "loading" });

    const name = recipeNameInput.trim();
    if (!name) {
      setSubmitStatus({ kind: "error", message: "Nombre es requerido." });
      return;
    }

    const yieldQty = normalizeIntegerInput(recipeYieldInput);
    if (!yieldQty) {
      setSubmitStatus({ kind: "error", message: "Rinde es requerido." });
      return;
    }

    const cleanedIngredients = recipeIngredients
      .map((item) => {
        const name = item.name.trim();
        const unitRaw = item.unit.trim().toUpperCase();
        const unit = unitRaw || defaultRecipeUnitForName(name);
        return {
          name,
          unit: unit || undefined,
          quantity: normalizeIntegerInput(item.quantity),
        };
      })
      .filter((item) => item.name || item.quantity);

    if (cleanedIngredients.length === 0) {
      setSubmitStatus({
        kind: "error",
        message: "Agrega al menos un ingrediente con cantidad (relación con costo e inventario).",
      });
      return;
    }

    for (const item of cleanedIngredients) {
      if (!item.name || !item.quantity) {
        setSubmitStatus({
          kind: "error",
          message: "Cada ingrediente debe tener nombre y cantidad.",
        });
        return;
      }
    }

    try {
      const endpoint = editingRecipeId
        ? `/api/inventory/recipes/${editingRecipeId}`
        : "/api/inventory/recipes";
      const method = editingRecipeId ? "PUT" : "POST";
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          yield_quantity: yieldQty,
          unit: recipeUnitInput.trim().toUpperCase() || null,
          ingredients: cleanedIngredients,
        }),
      });

      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        setSubmitStatus({
          kind: "error",
          message:
            (typeof payload?.message === "string" && payload.message) ||
            "No se pudo guardar la receta.",
        });
        return;
      }

      const created = payload as RecipeItem;
      setRecipes((prev) =>
        editingRecipeId
          ? prev.map((item) => (item.id === created.id ? created : item))
          : [created, ...prev],
      );
      setSubmitStatus({
        kind: "success",
        message: editingRecipeId ? "Receta actualizada." : "Receta creada.",
      });
      resetForm();
      setShowRecipeCreate(false);
    } catch {
      setSubmitStatus({
        kind: "error",
        message: "Error guardando la receta (revisa conexión al backend).",
      });
    }
  }

  async function handleUpdateProduct() {
    if (!editingId) return;
    setSubmitStatus({ kind: "loading" });

    const name = nameInput.trim();
    if (!name) {
      setSubmitStatus({ kind: "error", message: "Nombre es requerido." });
      return;
    }

    const quantity = quantityInput.trim();
    const totalCost = normalizeMoneyInput(totalCostInput);
    if (!quantity || !totalCost) {
      setSubmitStatus({ kind: "error", message: "Cantidad y costo total son requeridos." });
      return;
    }

    const unit = tab === "ingredient" ? unitInput.trim() : "";
    if (tab === "ingredient" && !unit) {
      setSubmitStatus({
        kind: "error",
        message: "La unidad es requerida para Ingredientes.",
      });
      return;
    }
    if (
      tab === "ingredient" &&
      !UNIT_OPTIONS.some((option) => option.value === unit)
    ) {
      setSubmitStatus({
        kind: "error",
        message: "La unidad debe ser: mililitros, gramos o unidades.",
      });
      return;
    }

    try {
      const response = await fetch(`/api/inventory/products/${editingId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          unit: tab === "ingredient" ? unit : null,
          on_hand: quantity,
          total_cost: totalCost,
        }),
      });

      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        setSubmitStatus({
          kind: "error",
          message:
            (typeof payload?.message === "string" && payload.message) ||
            "No se pudo editar el producto.",
        });
        return;
      }

      const updated = payload as InventoryProduct;
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setSubmitStatus({ kind: "success", message: "Producto actualizado." });
      setShowEdit(false);
      setEditingId(null);
      resetForm();
    } catch {
      setSubmitStatus({
        kind: "error",
        message: "Error editando el producto (revisa conexión al backend).",
      });
    }
  }

  async function handleDeleteProduct(id: number) {
    if (deletingIds.has(id)) return;
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      const response = await fetch(`/api/inventory/products/${id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json().catch(() => null)) as any;
        throw new Error((typeof payload?.message === "string" && payload.message) || "Error");
      }
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // ignore (could add toast later)
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleDeleteRecipe(id: number) {
    if (!window.confirm("¿Eliminar esta receta?")) return;
    try {
      const response = await fetch(`/api/inventory/recipes/${id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json().catch(() => null)) as any;
        throw new Error((typeof payload?.message === "string" && payload.message) || "Error");
      }
      setRecipes((prev) => prev.filter((item) => item.id !== id));
    } catch {
      // ignore (could add toast later)
    }
  }

  return (
    <div className="rounded-[10px] bg-white p-6 shadow-1 dark:bg-gray-dark dark:shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-dark dark:text-white">{viewTitle}</h2>
          <p className="text-sm text-body-color dark:text-dark-6">{viewHint}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              if (tab === "recipe") {
                openRecipeCreate();
              } else {
                openCreate();
              }
            }}
            className="rounded-md bg-dark px-4 py-2 text-sm font-medium text-white hover:bg-dark/90 dark:bg-white dark:text-dark dark:hover:bg-white/90"
          >
            {tab === "recipe"
              ? "Agregar receta"
              : tab === "ingredient"
                ? "Agregar Ingrediente"
                : "Agregar compra"}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("ingredient")}
          className={
            tab === "ingredient"
              ? "rounded-md bg-primary px-3 py-2 text-sm font-medium text-white"
              : "rounded-md border border-stroke px-3 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
          }
        >
          Ingredientes
        </button>
        <button
          type="button"
          onClick={() => setTab("material")}
          className={
            tab === "material"
              ? "rounded-md bg-primary px-3 py-2 text-sm font-medium text-white"
              : "rounded-md border border-stroke px-3 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
          }
        >
          Inventario Mobiliario
        </button>
        <button
          type="button"
          onClick={() => setTab("recipe")}
          className={
            tab === "recipe"
              ? "rounded-md bg-primary px-3 py-2 text-sm font-medium text-white"
              : "rounded-md border border-stroke px-3 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
          }
        >
          Recetas
        </button>
        <div className="relative ml-auto w-full max-w-xs">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar items..."
            className="w-full rounded-md border-2 border-primary/40 bg-white py-2 pl-11 pr-3 text-sm text-dark shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-dark-3 dark:bg-gray-dark dark:text-white"
          />
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
        </div>
      </div>

      {showCreate ? (
        <div className="mb-6 rounded-md border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark-2">
            <div className="mt-4">
            <div className="mb-2 text-sm font-semibold text-dark dark:text-white">
              Productos comprados
            </div>
            <p className="mb-2 text-xs text-primary dark:text-primary">
              Bajá después de cada linea hasta el cuadro de retención en la fuente (opción{" "}
              <span className="font-semibold">Compra vs Servicio</span> según tabla DIAN).
            </p>
            <div className="mb-2 text-xs text-body-color dark:text-dark-6">
              El costo unitario se calcula desde el total neto (sin IVA) y la cantidad. El IVA se aplica sobre ese
              subtotal.{" "}
              <span className="font-medium text-dark dark:text-white">
                Otros: egreso o compra con nombre propio, sin afectar stock de productos de inventario.
              </span>
            </div>
            <div className="mb-2 grid grid-cols-1 gap-2 text-xs font-semibold uppercase text-dark-6 md:grid-cols-[0.75fr_1.45fr_0.75fr_0.75fr_0.75fr_0.72fr_0.58fr_0.72fr_auto]">
              <div>Tipo</div>
              <div>Nombre producto</div>
              <div>Unidad</div>
              <div>Proveedor</div>
              <div>Cantidad</div>
              <div>Total neto</div>
              <div>IVA</div>
              <div>C. unit.</div>
              <div />
            </div>
            <div className="space-y-2">
              {purchaseItems.map((item, index) => {
                const unitCost = computeUnitCost(item.quantity, item.total_cost);
                return (
                  <div
                    key={`purchase-item-${index}`}
                    className="grid grid-cols-1 gap-2 md:grid-cols-[0.75fr_1.45fr_0.75fr_0.75fr_0.75fr_0.72fr_0.58fr_0.72fr_auto]"
                  >
                    <select
                      value={item.mode}
                      onChange={(e) => {
                        const nextMode = e.target.value as "existing" | "new" | "other";
                        updatePurchaseRow(index, "mode", nextMode);
                        if (nextMode === "new" && tab === "ingredient" && !item.unit) {
                          updatePurchaseRow(index, "unit", "gramos");
                        }
                        if (nextMode === "other" && !String(item.quantity).trim()) {
                          updatePurchaseRow(index, "quantity", "1");
                        }
                      }}
                      className="w-full rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                    >
                      <option value="existing">Existente</option>
                      <option value="new">Nuevo</option>
                      <option value="other">Otros</option>
                    </select>
                    {item.mode === "existing" ? (
                      <select
                        value={item.product_id}
                        onChange={(e) => {
                          const value = e.target.value;
                          updatePurchaseRow(index, "product_id", value);
                          const selected = products.find(
                            (product) => String(product.id) === value,
                          );
                          if (selected?.unit) {
                            updatePurchaseRow(
                              index,
                              "unit",
                              normalizeUnitValue(selected.unit),
                            );
                          }
                        }}
                        className="w-full rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      >
                        <option value="">Selecciona producto</option>
                        {products.map((product) => (
                          <option key={product.id} value={String(product.id)}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    ) : item.mode === "other" ? (
                      <input
                        value={item.product_name}
                        onChange={(e) =>
                          updatePurchaseRow(index, "product_name", e.target.value)
                        }
                        className="w-full rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                        placeholder="Descripcion (no actualiza inventario)"
                      />
                    ) : (
                      <input
                        value={item.product_name}
                        onChange={(e) =>
                          updatePurchaseRow(index, "product_name", e.target.value)
                        }
                        className="w-full rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                        placeholder="Nombre del producto"
                      />
                    )}
                    <select
                      value={item.mode === "other" ? "" : item.unit}
                      onChange={(e) => updatePurchaseRow(index, "unit", e.target.value)}
                      disabled={tab !== "ingredient" || item.mode === "existing" || item.mode === "other"}
                      className="w-full rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark outline-none focus:border-primary disabled:bg-gray-1 dark:border-dark-3 dark:bg-gray-dark dark:text-white dark:disabled:bg-dark-2"
                    >
                      {item.mode === "other" ? (
                        <option value="">—</option>
                      ) : tab !== "ingredient" ? (
                        <option value="">Sin unidad</option>
                      ) : (
                        UNIT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))
                      )}
                    </select>
                    <select
                      value={item.supplier_id}
                      onChange={(e) => updatePurchaseRow(index, "supplier_id", e.target.value)}
                      className="w-full rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                    >
                      <option value="">Sin proveedor</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={String(supplier.id)}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={item.quantity}
                      onChange={(e) => updatePurchaseRow(index, "quantity", e.target.value)}
                      className="w-full rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      inputMode="decimal"
                      placeholder="Cantidad"
                    />
                    <input
                      value={formatCopInput(item.total_cost)}
                      onChange={(e) =>
                        updatePurchaseRow(
                          index,
                          "total_cost",
                          normalizeMoneyInput(e.target.value),
                        )
                      }
                      className="w-full rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      inputMode="numeric"
                      placeholder="Total neto (sin IVA)"
                    />
                    <select
                      value={item.iva_rate}
                      onChange={(e) => updatePurchaseRow(index, "iva_rate", e.target.value)}
                      className="w-full rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                      title="IVA sobre subtotal neto"
                    >
                      <option value="0">0%</option>
                      <option value="0.05">5%</option>
                      <option value="0.19">19%</option>
                    </select>
                    <div className="flex items-center rounded-md border border-stroke bg-white px-2 py-2 text-sm text-dark dark:border-dark-3 dark:bg-gray-dark dark:text-white">
                      {formatCop(unitCost)}
                    </div>
                    <button
                      type="button"
                      onClick={() => removePurchaseRow(index)}
                      className="inline-flex items-center justify-center rounded-md border border-stroke px-2 py-2 text-sm font-medium text-red hover:bg-red/10 dark:border-dark-3"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={addPurchaseRow}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-stroke px-3 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M7.25 2.5a.75.75 0 011.5 0V7h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0V8.5H2.5a.75.75 0 010-1.5h4.75V2.5z" />
              </svg>
              Agregar producto
            </button>
          </div>

          <div id="purchase-withholding-section" className="mt-4 rounded-md border-2 border-primary/50 bg-white p-3 text-sm dark:border-primary/50 dark:bg-gray-dark">
            <div className="font-semibold text-dark dark:text-white">
              Retención en la fuente
            </div>
            <p className="mt-1 text-xs text-body-color dark:text-dark-6">
              Según régimen del proveedor (Compras → Proveedores), tipo de operación de esta orden y, si lo
              configuraste en el proveedor, un porcentaje fijo de retención. Bases desde las cuales procede la
              retención:{" "}
              Bases desde las cuales procede la retención:{" "}
              <span className="font-medium text-dark dark:text-white">{formatCop(RETE_FUENTE_BASE_COMPRA)}</span>{" "}
              si es compra de bienes y{" "}
              <span className="font-medium text-dark dark:text-white">{formatCop(RETE_FUENTE_BASE_SERVICIO)}</span>{" "}
              si es prestación de servicios.
            </p>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-body-color dark:text-dark-6">
                Tipo de operación (compra de bienes / servicio)
              </label>
              <select
                value={purchaseWithholdingOp}
                onChange={(e) =>
                  setPurchaseWithholdingOp(e.target.value === "service" ? "service" : "purchase")
                }
                className="w-full max-w-md rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
              >
                <option value="purchase">Compra (bienes)</option>
                <option value="service">Servicio</option>
              </select>
            </div>
            <div className="mt-3 space-y-1 text-xs leading-relaxed">
              <p className="text-body-color dark:text-dark-6">
                Subtotal de la orden{" "}
                <span className="font-medium text-dark dark:text-white">{formatCop(purchaseSubtotalCop)}</span>.
              </p>
              {purchaseWithholdingInfo.status === "no_supplier" ? (
                <p className="text-amber dark:text-orange-400">
                  Asigná un mismo proveedor en las líneas para calcular la retención aplicable.
                </p>
              ) : purchaseWithholdingInfo.status === "multi_supplier" ? (
                <p className="text-amber dark:text-orange-400">
                  Hay más de un proveedor en esta orden; la retención en la fuente no se registra hasta que
                  todas las líneas correspondan al mismo proveedor (o configurá líneas aparte por
                  proveedor).
                </p>
              ) : purchaseWithholdingInfo.status === "unknown_supplier" ? (
                <p className="text-red">Proveedor no encontrado en catálogo.</p>
              ) : (
                <>
                  <p className="text-dark dark:text-white">
                    Proveedor{" "}
                    <span className="font-semibold">{purchaseWithholdingInfo.supplier.name}</span>:{" "}
                    {purchaseWithholdingInfo.supplier.tax_regime === "natural"
                      ? `persona natural${
                          purchaseWithholdingInfo.declarant
                            ? ", declarante de renta"
                            : ", NO declarante de renta"
                        }.`
                      : "régimen común (declarante de renta)."}
                  </p>
                  {purchaseWithholdingInfo.applied ? (
                    <p className="text-green dark:text-green-400">
                      Aplica {(purchaseWithholdingInfo.applied.rateFrac * 100).toLocaleString("es-CO", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 2,
                      })}
                      %
                      {purchaseWithholdingInfo.applied.source === "custom"
                        ? " (porcentaje definido en el proveedor)"
                        : ""}{" "}
                      — retención estimada{" "}
                      <span className="font-semibold">{formatCop(purchaseWithholdingInfo.applied.amount)}</span>.
                    </p>
                  ) : (
                    <p className="text-body-color dark:text-dark-6">
                      No hay retención: el subtotal es inferior a la base aplicable ({formatCop(purchaseWithholdingInfo.basis)}).
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              {submitStatus.kind === "error" ? (
                <span className="text-red">{submitStatus.message}</span>
              ) : submitStatus.kind === "success" ? (
                <span className="text-green">{submitStatus.message}</span>
              ) : null}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setSubmitStatus({ kind: "idle" });
                }}
                className="rounded-md border border-stroke px-4 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitStatus.kind === "loading"}
                onClick={handleCreatePurchase}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {submitStatus.kind === "loading" ? "Guardando..." : "Registrar compra"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showRecipeCreate && !editingRecipeId ? (
        <div className="mb-6 rounded-md border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-dark dark:text-white">
                Rinde
              </label>
              <input
                value={recipeYieldInput}
                onChange={(e) => setRecipeYieldInput(e.target.value)}
                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                inputMode="decimal"
                placeholder="Ej: 1"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-dark dark:text-white">
                Unidad
              </label>
              <select
                value={recipeUnitInput}
                onChange={(e) => setRecipeUnitInput(e.target.value)}
                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
              >
                {RECIPE_UNIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 md:col-span-3">
              <label className="text-sm font-medium text-dark dark:text-white">
                Nombre de receta
              </label>
              <input
                value={recipeNameInput}
                onChange={(e) => setRecipeNameInput(e.target.value)}
                className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                placeholder="Ej: Hamburguesa clásica"
              />
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold text-dark dark:text-white">
              Ingredientes
            </div>
            {ingredientCacheLoading ? (
              <p className="mb-2 text-xs text-body-color dark:text-dark-6">
                Cargando ingredientes del inventario…
              </p>
            ) : (
              <p className="mb-2 text-xs text-body-color dark:text-dark-6">
                Buscá y elegí de la misma lista que en la pestaña Ingredientes (queda en caché
                mientras usás el formulario).
              </p>
            )}
            <div className="space-y-2">
              {recipeIngredients.map((item, index) => (
                <div
                  key={`recipe-ingredient-${index}`}
                  className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_1fr_auto]"
                >
                  <IngredientSearchField
                    name={item.name}
                    productId={item.productId}
                    options={ingredientCache}
                    loading={ingredientCacheLoading}
                    onNameChange={(v) => updateRecipeIngredient(index, "name", v)}
                    onSelectProduct={(p) => selectRecipeIngredientProduct(index, p)}
                  />
                  <input
                    value={item.quantity}
                    onChange={(e) =>
                      updateRecipeIngredient(index, "quantity", e.target.value)
                    }
                    className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                    inputMode="decimal"
                    placeholder="Cantidad"
                  />
                  <select
                    value={item.unit}
                    onChange={(e) => updateRecipeIngredient(index, "unit", e.target.value)}
                    className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                  >
                    {RECIPE_UNIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeRecipeIngredientRow(index)}
                    className="inline-flex items-center justify-center rounded-md border border-stroke px-2 py-2 text-sm font-medium text-red hover:bg-red/10 dark:border-dark-3"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRecipeIngredientRow}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-stroke px-3 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M7.25 2.5a.75.75 0 011.5 0V7h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0V8.5H2.5a.75.75 0 010-1.5h4.75V2.5z" />
              </svg>
              Agregar ingrediente
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              {submitStatus.kind === "error" ? (
                <span className="text-red">{submitStatus.message}</span>
              ) : submitStatus.kind === "success" ? (
                <span className="text-green">{submitStatus.message}</span>
              ) : null}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowRecipeCreate(false);
                  setSubmitStatus({ kind: "idle" });
                }}
                className="rounded-md border border-stroke px-4 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitStatus.kind === "loading"}
                onClick={handleCreateRecipe}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {submitStatus.kind === "loading" ? "Creando..." : "Crear receta"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="max-w-full overflow-x-auto pb-12">
        {tab === "recipe" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {loading ? (
              <div className="rounded-xl border border-stroke bg-white p-4 text-sm text-body-color dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
                Cargando...
              </div>
            ) : filteredRecipes.length === 0 ? (
              <div className="rounded-xl border border-stroke bg-white p-4 text-sm text-body-color dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
                No hay recetas registradas.
              </div>
            ) : (
              filteredRecipes.map((recipe) => (
                <div
                  key={recipe.id}
                  className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-stroke bg-gradient-to-br from-gray-1 to-gray-3 p-4 shadow-sm transition hover:border-secondary dark:hover:border-secondary hover:shadow-lg shadow-secondary dark:hover:shadow-lg dark:shadow-secondary dark:border-dark-3 dark:bg-gradient-to-br dark:from-dark-2 dark:to-[#0b1320]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-dark dark:text-white">
                        {recipe.name}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-secondary">
                        Rinde {formatQtyPlain(recipe.yield_quantity)}
                        {recipe.unit ? ` ${formatUnitAbbr(recipe.unit)}` : ""}
                      </div>
                    </div>
                    <div className="rounded-full bg-white px-2 py-1 text-xs font-medium text-dark-6 shadow-sm dark:bg-dark-3/70 dark:text-dark-6">
                      {recipe.created_at
                        ? new Date(recipe.created_at).toLocaleDateString("es-CO")
                        : "-"}
                    </div>
                  </div>

                  <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-dark-6 dark:text-dark-6">
                    Ingredientes
                  </div>

                  <div className="mt-2 space-y-2 text-sm text-dark dark:text-white">
                    {recipe.ingredients?.length ? (
                      recipe.ingredients.map((ingredient, index) => (
                        <div
                          key={`${recipe.id}-ing-${index}`}
                          className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-2 py-1 dark:bg-dark-3/70"
                        >
                          <span className="font-semibold text-dark dark:text-white">
                            {ingredient.name}
                          </span>
                          <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-xs font-semibold text-secondary">
                            {formatRecipeCatalogIngredientBadge(ingredient)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-dark-6 dark:text-dark-6">
                        Sin ingredientes definidos.
                      </div>
                    )}
                  </div>

                  {editingRecipeId === recipe.id ? (
                    <div className="mt-4 rounded-xl border border-stroke bg-white/80 p-3 dark:border-dark-3 dark:bg-dark-3/40">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold uppercase text-dark-6 dark:text-dark-6">
                            Rinde
                          </label>
                          <input
                            value={recipeYieldInput}
                            onChange={(e) => setRecipeYieldInput(e.target.value)}
                            className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                            inputMode="decimal"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold uppercase text-dark-6 dark:text-dark-6">
                            Unidad
                          </label>
                          <select
                            value={recipeUnitInput}
                            onChange={(e) => setRecipeUnitInput(e.target.value)}
                            className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                          >
                            {RECIPE_UNIT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1 md:col-span-3">
                          <label className="text-xs font-semibold uppercase text-dark-6 dark:text-dark-6">
                            Nombre
                          </label>
                          <input
                            value={recipeNameInput}
                            onChange={(e) => setRecipeNameInput(e.target.value)}
                            className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                          />
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {ingredientCacheLoading ? (
                          <p className="text-xs text-body-color dark:text-dark-6">
                            Cargando ingredientes del inventario…
                          </p>
                        ) : null}
                        {recipeIngredients.map((item, index) => (
                          <div
                            key={`recipe-ingredient-edit-${index}`}
                            className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_1fr_auto]"
                          >
                            <IngredientSearchField
                              name={item.name}
                              productId={item.productId}
                              options={ingredientCache}
                              loading={ingredientCacheLoading}
                              onNameChange={(v) => updateRecipeIngredient(index, "name", v)}
                              onSelectProduct={(p) => selectRecipeIngredientProduct(index, p)}
                            />
                            <input
                              value={item.quantity}
                              onChange={(e) =>
                                updateRecipeIngredient(index, "quantity", e.target.value)
                              }
                              className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                              inputMode="decimal"
                              placeholder="Cantidad"
                            />
                            <select
                              value={item.unit}
                              onChange={(e) =>
                                updateRecipeIngredient(index, "unit", e.target.value)
                              }
                              className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                            >
                              {RECIPE_UNIT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeRecipeIngredientRow(index)}
                              className="inline-flex items-center justify-center rounded-md border border-stroke px-2 py-2 text-sm font-medium text-red hover:bg-red/10 dark:border-dark-3"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={addRecipeIngredientRow}
                          className="inline-flex items-center gap-2 rounded-md border border-stroke px-3 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                        >
                          <svg
                            className="h-4 w-4"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M7.25 2.5a.75.75 0 011.5 0V7h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0V8.5H2.5a.75.75 0 010-1.5h4.75V2.5z" />
                          </svg>
                          Agregar ingrediente
                        </button>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={cancelRecipeEdit}
                            className="rounded-md border border-stroke px-4 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={submitStatus.kind === "loading"}
                            onClick={handleCreateRecipe}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                          >
                            {submitStatus.kind === "loading" ? "Guardando..." : "Guardar"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-auto flex justify-center gap-2 pt-4">
                    <button
                      type="button"
                      onClick={() => openRecipeEdit(recipe)}
                      className="rounded-md border border-stroke border-dark-3 px-3 py-1.5 text-sm font-medium text-dark transition dark:border-dark-3 dark:text-white"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRecipe(recipe.id)}
                      className="rounded-md bg-red px-3 py-1.5 text-sm font-medium text-white hover:bg-red/90"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <table className="w-full table-auto">
            <thead>
              <tr className="bg-gray-2 text-left dark:bg-dark-2">
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">
                  Producto
                </th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">
                  Unidad
                </th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">
                  Stock
                </th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">
                  Costo unit.
                </th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">
                  Costo total
                </th>
                <th className="px-4 py-3 text-sm font-medium text-dark dark:text-white">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-sm text-body-color dark:text-dark-6"
                  >
                    Cargando...
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-sm text-body-color dark:text-dark-6"
                  >
                    No hay productos en esta sección.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="border-b border-stroke dark:border-dark-3">
                      <td className="px-4 py-3 text-sm text-dark dark:text-white">
                        {p.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {formatUnitAbbr(p.unit)}
                      </td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {formatQty(p.on_hand)}
                      </td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {formatCop(p.average_cost)}
                      </td>
                      <td className="px-4 py-3 text-sm text-body-color dark:text-dark-6">
                        {(() => {
                          const qty = safeNumber(p.on_hand);
                          const unitCost = safeNumber(p.average_cost);
                          if (qty === null || unitCost === null) return "-";
                          return formatCop(qty * unitCost);
                        })()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            className="rounded-md border border-stroke px-3 py-1.5 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={deletingIds.has(p.id)}
                            onClick={() => handleDeleteProduct(p.id)}
                            className="rounded-md bg-red px-3 py-1.5 text-sm font-medium text-white hover:bg-red/90 disabled:opacity-60"
                          >
                            {deletingIds.has(p.id) ? "Eliminando..." : "Eliminar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {showEdit && editingId === p.id ? (
                      <tr className="border-b border-stroke dark:border-dark-3">
                        <td colSpan={6} className="px-4 pb-4 pt-2">
                          <div className="rounded-md border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark-2">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                              <div className="flex flex-col gap-1">
                                <label className="text-sm font-medium text-dark dark:text-white">
                                  Nombre
                                </label>
                                <input
                                  value={nameInput}
                                  onChange={(e) => setNameInput(e.target.value)}
                                  className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                                  placeholder={
                                    tab === "ingredient"
                                      ? "Ej: Queso mozzarella"
                                      : "Ej: Vaso desechable"
                                  }
                                />
                              </div>

                              <div className="flex flex-col gap-1">
                                <label className="text-sm font-medium text-dark dark:text-white">
                                  Cantidad
                                </label>
                                <input
                                  value={quantityInput}
                                  onChange={(e) => setQuantityInput(e.target.value)}
                                  className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                                  inputMode="decimal"
                                  placeholder={tab === "ingredient" ? "Ej: 5" : "Ej: 100"}
                                />
                              </div>

                              {tab === "ingredient" ? (
                                <div className="flex flex-col gap-1">
                                  <label className="text-sm font-medium text-dark dark:text-white">
                                    Unidad
                                  </label>
                                  <select
                                    value={unitInput}
                                    onChange={(e) => setUnitInput(e.target.value)}
                                    className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                                  >
                                    <option value="">Selecciona unidad</option>
                                    {UNIT_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <div />
                              )}

                              <div className="flex flex-col gap-1">
                                <label className="text-sm font-medium text-dark dark:text-white">
                                  Costo total
                                </label>
                                <input
                                  value={formatCopInput(totalCostInput)}
                                  onChange={(e) =>
                                    setTotalCostInput(normalizeMoneyInput(e.target.value))
                                  }
                                  className="w-full rounded-md border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                                  inputMode="decimal"
                                  placeholder="Ej: 45000"
                                />
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm">
                                {submitStatus.kind === "error" ? (
                                  <span className="text-red">{submitStatus.message}</span>
                                ) : submitStatus.kind === "success" ? (
                                  <span className="text-green">{submitStatus.message}</span>
                                ) : null}
                              </div>

                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowEdit(false);
                                    setEditingId(null);
                                    setSubmitStatus({ kind: "idle" });
                                  }}
                                  className="rounded-md border border-stroke px-4 py-2 text-sm font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  disabled={submitStatus.kind === "loading"}
                                  onClick={handleUpdateProduct}
                                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                                >
                                  {submitStatus.kind === "loading" ? "Guardando..." : "Guardar"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
