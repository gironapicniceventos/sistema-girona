"use client";

import { useEffect, useMemo, useState } from "react";
import type { IconType } from "react-icons";
import {
  RiDeleteBinLine,
  RiDrinks2Fill,
  RiEdit2Line,
  RiRestaurantLine,
} from "react-icons/ri";
import { Tooltip } from "@/components/ui/tooltip";
import { SearchIcon } from "@/assets/icons";
import {
  BAR_CATEGORY_ICONS as BAR_NAV,
  getPosCategoryIcon,
  RESTAURANTE_CATEGORY_ICONS as RESTAURANTE_NAV,
} from "@/lib/pos-menu-category-icons";

type MenuItem = {
  id: number;
  name: string;
  category: string;
  price: string | number;
  description?: string | null;
  ingredients?: MenuIngredient[] | string[] | null;
};

type MenuIngredient = {
  name: string;
  unit: string;
  weight: string | number;
  price: string | number;
  total?: string | number;
};

type RecipeIngredientDraft = {
  name: string;
  unit: string;
  weight: string;
  price: string;
};

type InventoryProduct = {
  id: number;
  name: string;
  unit: string | null;
  source: "ingredient" | "recipe";
};

/** Recetas de inventario interno (no platos de menú): solo las marcadas como insumo. */
function isInsumoPrefixedRecipeName(name: string): boolean {
  return name.trim().toUpperCase().startsWith("[INSUMO]");
}

function formatCategory(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function categoryKey(value: string) {
  return slugify(value);
}

function categoryToId(category: string) {
  return `cat-${slugify(category)}`;
}

function formatCopPrice(value: string | number) {
  const raw = String(value);
  const normalized = raw.replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  const asNumber = Number.parseFloat(normalized.replace(/,/g, "."));
  if (!Number.isFinite(asNumber)) return `$${raw}`;

  const formatted = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(asNumber);

  return `$${formatted}`;
}

function normalizeCopIntegerInput(value: string | number) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const cleaned = raw.replace(/\s/g, "").replace(/[^\d.,-]/g, "");

  const looksLikeThousandsSep = (s: string, sep: "." | ",") => {
    const parts = s.split(sep);
    if (parts.length <= 1) return false;
    if (!parts.every((p) => /^\d+$/.test(p))) return false;
    return [1, 2, 3].includes(parts[0]!.length) && parts.slice(1).every((p) => p.length === 3);
  };

  let normalized = cleaned;
  if (cleaned.includes(".") && cleaned.includes(",")) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (cleaned.includes(".")) {
    normalized = looksLikeThousandsSep(cleaned, ".") ? cleaned.replace(/\./g, "") : cleaned;
  } else if (cleaned.includes(",")) {
    normalized = looksLikeThousandsSep(cleaned, ",") ? cleaned.replace(/,/g, "") : cleaned.replace(/,/g, ".");
  }

  const asNumber = Number.parseFloat(normalized);
  if (!Number.isFinite(asNumber)) return "";
  return String(Math.trunc(asNumber));
}

function parseDecimalInput(value: string | number) {
  let raw = String(value ?? "").trim();
  if (!raw) return 0;

  raw = raw.replace(/\s/g, "");

  const looksLikeThousandsSep = (input: string, sep: "." | ",") => {
    const parts = input.split(sep);
    if (parts.length <= 1) return false;
    if (!parts.every((p) => /^\d+$/.test(p))) return false;
    return [1, 2, 3].includes(parts[0]!.length) && parts.slice(1).every((p) => p.length === 3);
  };

  if (raw.includes(".") && raw.includes(",")) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      raw = raw.replace(/\./g, "").replace(/,/g, ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  } else if (raw.includes(".")) {
    if (looksLikeThousandsSep(raw, ".")) raw = raw.replace(/\./g, "");
  } else if (raw.includes(",")) {
    raw = looksLikeThousandsSep(raw, ",") ? raw.replace(/,/g, "") : raw.replace(/,/g, ".");
  }

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUnitAbbr(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "mililitros" || raw.toUpperCase() === "ML") return "ML";
  if (lower === "gramos" || raw.toUpperCase() === "GR") return "GR";
  if (lower === "unidades" || raw.toUpperCase() === "UND") return "Unidad";
  return raw.toUpperCase();
}

function isMenuIngredient(value: unknown): value is MenuIngredient {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "unit" in value &&
    "weight" in value &&
    "price" in value
  );
}

function getIngredientNames(ingredients: MenuItem["ingredients"]) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients
    .map((item) => (isMenuIngredient(item) ? item.name : String(item ?? "")))
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Acentos y mayúsculas no afectan la búsqueda (ej. LIMONADA ≈ limonada). */
function normalizeForMenuSearch(value: string): string {
  return value
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function menuItemSearchHaystack(item: MenuItem): string {
  const parts = [
    String(item.name ?? ""),
    String(item.category ?? ""),
    String(item.description ?? ""),
    ...getIngredientNames(item.ingredients),
  ];
  return normalizeForMenuSearch(parts.join(" "));
}

function normalizeRecipeDraft(ingredients: MenuItem["ingredients"]) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return [{ name: "", unit: "", weight: "", price: "" }];
  }
  if (ingredients.every((item) => !isMenuIngredient(item))) {
    return ingredients.map((item) => ({
      name: String(item ?? "").trim(),
      unit: "",
      weight: "",
      price: "",
    }));
  }
  return (ingredients as MenuIngredient[]).map((item) => ({
    name: item.name ?? "",
    unit: item.unit ?? "",
    weight: item.weight !== undefined ? String(item.weight) : "",
    price: item.price !== undefined ? String(item.price) : "",
  }));
}

const DEFAULT_BAR_CATEGORIES = new Set(
  [
    "Bebidas",
    "Malteadas",
    "Dulces bar",
    "Sodas",
    "Gaseosas",
    "Para el Almuerzo",
    "Cervezas nacionales",
    "Cervezas Internacionales",
    "Micheladas",
    "Licores y Shots",
    "Cubetazos",
    "Cocteleria",
    "Vinos",
  ].map(categoryKey),
);

const STORAGE_KEY_BAR_CATEGORIES = "girona.menu.customBarCategories";
const STORAGE_KEY_RESTAURANTE_CATEGORIES = "girona.menu.customRestauranteCategories";

function getCategoryNavIcon(label: string, tab: "restaurante" | "bar"): IconType {
  return getPosCategoryIcon(label, tab === "bar" ? "bar" : "rest");
}

export default function Menu({
  items,
  readOnly = false,
}: {
  items: MenuItem[];
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<"restaurante" | "bar">("restaurante");
  const [localItems, setLocalItems] = useState<MenuItem[]>(items);

  const [customBarCategories, setCustomBarCategories] = useState<string[]>([]);
  const [customRestauranteCategories, setCustomRestauranteCategories] = useState<
    string[]
  >([]);

  const [showCreate, setShowCreate] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editingOriginalCategoryKey, setEditingOriginalCategoryKey] = useState<
    string | null
  >(null);
  const [categoryInput, setCategoryInput] = useState("");
  const [categoryMode, setCategoryMode] = useState<"existing" | "new">("existing");
  const [categoryNewInput, setCategoryNewInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [submitStatus, setSubmitStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [deletingIds, setDeletingIds] = useState<Set<number>>(() => new Set());
  const [recipeModalItem, setRecipeModalItem] = useState<MenuItem | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeIngredientDraft[]>([]);
  const [recipeStatus, setRecipeStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [inventoryProducts, setInventoryProducts] = useState<InventoryProduct[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  /** Ordena la categoría elegida en el nav como primera sección (restaurante/bar). */
  const [priorityCategoryKey, setPriorityCategoryKey] = useState<string | null>(null);

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  useEffect(() => {
    setPriorityCategoryKey(null);
  }, [tab]);

  useEffect(() => {
    if (searchQuery.trim()) setPriorityCategoryKey(null);
  }, [searchQuery]);

  useEffect(() => {
    if (!showCreate) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowCreate(false);
        cancelEdit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showCreate]);

  useEffect(() => {
    if (!recipeModalItem) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeRecipeModal();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [recipeModalItem]);

  useEffect(() => {
    if (!recipeModalItem && !showCreate) return;
    setInventoryLoading(true);
    setInventoryError(null);
    Promise.all([
      fetch("/api/inventory/products?kind=ingredient", { cache: "no-store" })
        .then((res) => res.json().catch(() => null)),
      fetch("/api/inventory/recipes", { cache: "no-store" })
        .then((res) => res.json().catch(() => null)),
    ])
      .then(([productsPayload, recipesPayload]) => {
        if (!Array.isArray(productsPayload) || !Array.isArray(recipesPayload)) {
          throw new Error("No se pudo cargar inventario.");
        }

        const ingredients = productsPayload
          .map((item: any) => ({
            id: Number(item?.id),
            name: String(item?.name ?? ""),
            unit: item?.unit ? String(item.unit) : null,
            source: "ingredient" as const,
          }))
          .filter((item) => Number.isFinite(item.id) && item.name);

        const recipes = recipesPayload
          .map((item: any) => ({
            id: Number(item?.id),
            name: String(item?.name ?? ""),
            unit: item?.unit ? String(item.unit) : null,
            source: "recipe" as const,
          }))
          .filter((item) => Number.isFinite(item.id) && item.name)
          .filter((item) => isInsumoPrefixedRecipeName(item.name));

        const merged = new Map<string, InventoryProduct>();
        for (const item of [...ingredients, ...recipes]) {
          const key = item.name.toLowerCase();
          if (!merged.has(key)) merged.set(key, item);
        }

        setInventoryProducts([...merged.values()].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "No se pudo cargar inventario.";
        setInventoryError(message);
        setInventoryProducts([]);
      })
      .finally(() => setInventoryLoading(false));
  }, [recipeModalItem, showCreate]);

  useEffect(() => {
    if (!inventoryProducts.length) return;
    setRecipeDraft((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.unit) return row;
        if (!row.name) return row;
        const match = inventoryProducts.find(
          (item) => item.name.toLowerCase() === row.name.toLowerCase(),
        );
        if (match?.unit) {
          changed = true;
          return { ...row, unit: match.unit };
        }
        return row;
      });
      return changed ? next : prev;
    });
  }, [inventoryProducts]);

  useEffect(() => {
    try {
      const storedBar = window.localStorage.getItem(STORAGE_KEY_BAR_CATEGORIES);
      if (storedBar) {
        const parsed = JSON.parse(storedBar);
        if (Array.isArray(parsed)) {
          setCustomBarCategories(parsed.filter((v) => typeof v === "string"));
        }
      }
      const storedRest = window.localStorage.getItem(
        STORAGE_KEY_RESTAURANTE_CATEGORIES,
      );
      if (storedRest) {
        const parsed = JSON.parse(storedRest);
        if (Array.isArray(parsed)) {
          setCustomRestauranteCategories(
            parsed.filter((v) => typeof v === "string"),
          );
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const recipeTotals = useMemo(() => {
    return recipeDraft.reduce(
      (acc, row) => {
        const weight = parseDecimalInput(row.weight);
        const price = parseDecimalInput(row.price);
        acc.gramaje += weight;
        acc.costo += weight * price;
        return acc;
      },
      { gramaje: 0, costo: 0 },
    );
  }, [recipeDraft]);

  function persistBarCategories(next: string[]) {
    setCustomBarCategories(next);
    try {
      window.localStorage.setItem(STORAGE_KEY_BAR_CATEGORIES, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function persistRestauranteCategories(next: string[]) {
    setCustomRestauranteCategories(next);
    try {
      window.localStorage.setItem(
        STORAGE_KEY_RESTAURANTE_CATEGORIES,
        JSON.stringify(next),
      );
    } catch {
      // ignore
    }
  }

  const barCategoryKeySet = useMemo(() => {
    const merged = new Set(DEFAULT_BAR_CATEGORIES);
    for (const c of customBarCategories) merged.add(categoryKey(c));
    return merged;
  }, [customBarCategories]);

  const { barItems, restauranteItems } = useMemo(() => {
    const bar: MenuItem[] = [];
    const restaurante: MenuItem[] = [];

    for (const item of localItems) {
      const category = categoryKey(item.category);
      if (barCategoryKeySet.has(category)) bar.push(item);
      else restaurante.push(item);
    }

    return { barItems: bar, restauranteItems: restaurante };
  }, [barCategoryKeySet, localItems]);

  const activeItems = tab === "bar" ? barItems : restauranteItems;
  const filteredItems = useMemo(() => {
    const queryRaw = searchQuery.trim();
    if (!queryRaw) return activeItems;
    const query = normalizeForMenuSearch(queryRaw);
    if (!query) return activeItems;
    return activeItems.filter((item) => menuItemSearchHaystack(item).includes(query));
  }, [activeItems, searchQuery]);

  const grouped = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of filteredItems) {
      const key = formatCategory(item.category);
      const existing = map.get(key);
      if (existing) existing.push(item);
      else map.set(key, [item]);
    }
    const pin = priorityCategoryKey;
    return [...map.entries()].sort((a, b) => {
      if (pin) {
        const aK = categoryKey(a[1][0]!.category);
        const bK = categoryKey(b[1][0]!.category);
        const aFirst = aK === pin ? 0 : 1;
        const bFirst = bK === pin ? 0 : 1;
        if (aFirst !== bFirst) return aFirst - bFirst;
      }
      return a[0].localeCompare(b[0]);
    });
  }, [filteredItems, priorityCategoryKey]);

  function handleCategoryNavClick(label: string) {
    const k = categoryKey(label);
    setPriorityCategoryKey(k);
    const match = filteredItems.find((item) => categoryKey(item.category) === k);
    if (!match) return;
    const id = categoryToId(formatCategory(match.category));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  const activeCategorySet = useMemo(() => {
    const set = new Set<string>();
    for (const item of activeItems) set.add(categoryKey(item.category));
    return set;
  }, [activeItems]);

  const categoryOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const item of activeItems) {
      const trimmed = String(item.category ?? "").trim();
      if (!trimmed) continue;
      const key = categoryKey(trimmed);
      if (!byKey.has(key)) byKey.set(key, formatCategory(trimmed));
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [activeItems]);

  const customCategoryKeySet = useMemo(() => {
    const list = tab === "bar" ? customBarCategories : customRestauranteCategories;
    const set = new Set<string>();
    for (const c of list) set.add(categoryKey(c));
    return set;
  }, [customBarCategories, customRestauranteCategories, tab]);

  const customCategoryLabels = useMemo(() => {
    const fixedKeys = new Set(
      (tab === "bar" ? BAR_NAV : RESTAURANTE_NAV).map((c) => categoryKey(c.label)),
    );
    const list = tab === "bar" ? customBarCategories : customRestauranteCategories;
    const merged = new Map<string, string>();
    for (const c of list) {
      const trimmed = c.trim();
      if (!trimmed) continue;
      const key = categoryKey(trimmed);
      if (fixedKeys.has(key)) continue;
      if (!merged.has(key)) merged.set(key, trimmed);
    }
    return [...merged.values()].sort((a, b) => a.localeCompare(b));
  }, [customBarCategories, customRestauranteCategories, tab]);

  function createCategory(category: string) {
    const trimmed = category.trim();
    if (!trimmed) return;

    if (tab === "bar") {
      if (customBarCategories.some((c) => categoryKey(c) === categoryKey(trimmed)))
        return;
      persistBarCategories([...customBarCategories, trimmed]);
    } else {
      if (
        customRestauranteCategories.some(
          (c) => categoryKey(c) === categoryKey(trimmed),
        )
      )
        return;
      persistRestauranteCategories([...customRestauranteCategories, trimmed]);
    }
  }

  function startCreate() {
    setShowCreate(true);
    setFormMode("create");
    setEditingId(null);
    setEditingItem(null);
    setRecipeDraft([{ name: "", unit: "", weight: "", price: "" }]);
    setEditingOriginalCategoryKey(null);
    setSubmitStatus({ kind: "idle" });
    setCategoryInput("");
    setCategoryMode("existing");
    setCategoryNewInput("");
    setNameInput("");
    setPriceInput("");
    setDescriptionInput("");
  }

  function startEdit(item: MenuItem) {
    setShowCreate(true);
    setFormMode("edit");
    setEditingId(item.id);
    setEditingItem(item);
    setRecipeDraft(normalizeRecipeDraft(item.ingredients));
    setEditingOriginalCategoryKey(categoryKey(item.category));
    setSubmitStatus({ kind: "idle" });
    setCategoryInput(item.category ?? "");
    setCategoryMode("existing");
    setCategoryNewInput("");
    setNameInput(item.name ?? "");
    setPriceInput(normalizeCopIntegerInput(item.price ?? ""));
    setDescriptionInput(item.description ?? "");
  }

  function cancelEdit() {
    setFormMode("create");
    setEditingId(null);
    setEditingItem(null);
    setEditingOriginalCategoryKey(null);
    setSubmitStatus({ kind: "idle" });
    setNameInput("");
    setPriceInput("");
    setDescriptionInput("");
    setCategoryMode("existing");
    setCategoryNewInput("");
    setRecipeDraft([]);
  }

  function openRecipeModal(item: MenuItem) {
    setRecipeModalItem(item);
    setRecipeDraft(normalizeRecipeDraft(item.ingredients));
    setRecipeStatus({ kind: "idle" });
  }

  function closeRecipeModal() {
    setRecipeModalItem(null);
    setRecipeDraft([]);
    setRecipeStatus({ kind: "idle" });
  }

  function updateRecipeRow(index: number, field: keyof RecipeIngredientDraft, value: string) {
    setRecipeDraft((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  function selectInventoryItem(index: number, name: string) {
    const selected = inventoryProducts.find((item) => item.name === name);
    setRecipeDraft((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              name,
              unit: selected?.unit ?? row.unit ?? "",
            }
          : row,
      ),
    );
  }

  function addRecipeRow() {
    setRecipeDraft((prev) => [...prev, { name: "", unit: "", weight: "", price: "" }]);
  }

  function removeRecipeRow(index: number) {
    setRecipeDraft((prev) => prev.filter((_, i) => i !== index));
  }

  function buildRecipeIngredients(draft: RecipeIngredientDraft[]) {
    const cleaned = draft
      .map((row) => ({
        name: row.name.trim(),
        unit: row.unit ? row.unit.trim().toUpperCase() : "",
        weight: parseDecimalInput(row.weight),
        price: parseDecimalInput(row.price),
      }))
      .filter((row) => row.name || row.weight || row.price);

    if (cleaned.length === 0) {
      return {
        ok: false as const,
        error:
          "Debes agregar al menos un ingrediente con su cantidad (peso) para vincular costo e inventario.",
      };
    }

    const invalidRow = cleaned.find(
      (row) => !row.name || row.weight <= 0 || row.price < 0,
    );
    if (invalidRow) {
      return {
        ok: false as const,
        error: "Completa ingrediente, cantidad (peso) y precio en cada fila (cantidades mayores a cero).",
      };
    }

    return {
      ok: true as const,
      ingredients: cleaned.map((row) => ({
        name: row.name,
        unit: row.unit || undefined,
        weight: row.weight,
        price: row.price,
        total: Number((row.weight * row.price).toFixed(2)),
      })),
    };
  }

  async function handleSaveRecipe() {
    if (!recipeModalItem) return;

    const cleaned = recipeDraft
      .map((row) => ({
        name: row.name.trim(),
        unit: row.unit.trim().toUpperCase(),
        weight: parseDecimalInput(row.weight),
        price: parseDecimalInput(row.price),
      }))
      .filter((row) => row.name || row.weight || row.price);

    if (cleaned.length === 0) {
      setRecipeStatus({
        kind: "error",
        message: "Agrega al menos un ingrediente.",
      });
      return;
    }

    const invalidRow = cleaned.find(
      (row) => !row.name || !row.unit || row.weight <= 0 || row.price < 0,
    );
    if (invalidRow) {
      setRecipeStatus({
        kind: "error",
        message: "Completa ingrediente, peso y precio para cada fila.",
      });
      return;
    }

    const ingredients = cleaned.map((row) => ({
      name: row.name,
      unit: row.unit,
      weight: row.weight,
      price: row.price,
      total: Number((row.weight * row.price).toFixed(2)),
    }));

    setRecipeStatus({ kind: "loading" });

    const price = normalizeCopIntegerInput(recipeModalItem.price ?? "");
    try {
      const response = await fetch(`/api/menu/items/${recipeModalItem.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: recipeModalItem.name,
          category: recipeModalItem.category,
          price: Number(price),
          description: recipeModalItem.description ?? null,
          ingredients,
        }),
      });

      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        setRecipeStatus({
          kind: "error",
          message:
            (typeof payload?.message === "string" && payload.message) ||
            "No se pudo guardar la receta.",
        });
        return;
      }

      const updated = payload as MenuItem;
      setLocalItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setRecipeStatus({ kind: "success", message: "Receta guardada." });
      setRecipeModalItem(updated);
      closeRecipeModal();
    } catch {
      setRecipeStatus({
        kind: "error",
        message: "Error guardando la receta (revisa conexión al backend).",
      });
    }
  }

  async function handleCreateItem() {
    setSubmitStatus({ kind: "loading" });

    const category =
      categoryMode === "new" ? categoryNewInput.trim() : categoryInput.trim();
    const name = nameInput.trim();
    const price = normalizeCopIntegerInput(priceInput);
    const description = descriptionInput.trim();

    const recipeResult = buildRecipeIngredients(recipeDraft);
    if (!recipeResult.ok) {
      setSubmitStatus({ kind: "error", message: recipeResult.error });
      return;
    }

    if (!category || !name || !price) {
      setSubmitStatus({
        kind: "error",
        message: "Nombre, categoría y precio son requeridos.",
      });
      return;
    }

    try {
      const response = await fetch("/api/menu/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          price: Number(price),
          description: description ? description : null,
          ingredients: recipeResult.ingredients,
        }),
      });

      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        setSubmitStatus({
          kind: "error",
          message:
            (typeof payload?.message === "string" && payload.message) ||
            "No se pudo crear el item.",
        });
        return;
      }

      const created = payload as MenuItem;
      setLocalItems((prev) => [created, ...prev]);
      createCategory(created.category);

      setSubmitStatus({ kind: "success", message: "Item creado." });
      setNameInput("");
      setPriceInput("");
      setDescriptionInput("");
      setCategoryInput("");
      setShowCreate(false);
      cancelEdit();
    } catch {
      setSubmitStatus({
        kind: "error",
        message: "Error creando el item (revisa conexión al backend).",
      });
    }
  }

  async function handleUpdateItem() {
    if (!editingId) return;
    setSubmitStatus({ kind: "loading" });

    const category =
      categoryMode === "new" ? categoryNewInput.trim() : categoryInput.trim();
    const name = nameInput.trim();
    const price = normalizeCopIntegerInput(priceInput);
    const description = descriptionInput.trim();
    const recipeResult = buildRecipeIngredients(recipeDraft);
    if (!recipeResult.ok) {
      setSubmitStatus({ kind: "error", message: recipeResult.error });
      return;
    }

    if (!category || !name || !price) {
      setSubmitStatus({
        kind: "error",
        message: "Nombre, categoría y precio son requeridos.",
      });
      return;
    }

    try {
      const response = await fetch(`/api/menu/items/${editingId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          price: Number(price),
          description: description ? description : null,
          ingredients: recipeResult.ingredients,
        }),
      });

      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        setSubmitStatus({
          kind: "error",
          message:
            (typeof payload?.message === "string" && payload.message) ||
            "No se pudo editar el item.",
        });
        return;
      }

      const updated = payload as MenuItem;
      const updatedCategoryKey = categoryKey(updated.category);
      const originalCategoryKey = editingOriginalCategoryKey;

      setLocalItems((prev) =>
        prev.map((i) => (i.id === editingId ? updated : i)),
      );
      createCategory(updated.category);

      if (originalCategoryKey && originalCategoryKey !== updatedCategoryKey) {
        const itemWasBar = barCategoryKeySet.has(originalCategoryKey);
        const list = itemWasBar ? barItems : restauranteItems;
        const stillExists = list.some(
          (i) => i.id !== editingId && categoryKey(i.category) === originalCategoryKey,
        );
        if (!stillExists) {
          if (itemWasBar) {
            const next = customBarCategories.filter(
              (c) => categoryKey(c) !== originalCategoryKey,
            );
            if (next.length !== customBarCategories.length) persistBarCategories(next);
          } else {
            const next = customRestauranteCategories.filter(
              (c) => categoryKey(c) !== originalCategoryKey,
            );
            if (next.length !== customRestauranteCategories.length)
              persistRestauranteCategories(next);
          }
        }
      }

      setSubmitStatus({ kind: "success", message: "Item actualizado." });
      setShowCreate(false);
      setCategoryInput("");
      cancelEdit();
    } catch {
      setSubmitStatus({
        kind: "error",
        message: "Error editando el item (revisa conexión al backend).",
      });
    }
  }

  function handleDeleteCategory(category: string) {
    const key = categoryKey(category);
    const count = localItems.filter((i) => categoryKey(i.category) === key).length;

    const isCustom = customCategoryKeySet.has(key);
    if (!isCustom) {
      window.alert("Solo puedes eliminar categorías creadas por ti.");
      return;
    }

    if (count > 0) {
      window.alert(
        "No puedes eliminar una categoría que aún tiene items. Elimina primero los items.",
      );
      return;
    }

    const ok = window.confirm(`Eliminar la categoría "${category}"?`);
    if (!ok) return;

    if (tab === "bar") {
      persistBarCategories(customBarCategories.filter((c) => categoryKey(c) !== key));
    } else {
      persistRestauranteCategories(
        customRestauranteCategories.filter((c) => categoryKey(c) !== key),
      );
    }

    if (categoryKey(categoryInput) === key) setCategoryInput("");
  }

  async function handleDeleteItem(itemId: number) {
    const item = localItems.find((i) => i.id === itemId);
    if (!item) return;

    const ok = window.confirm(`Eliminar "${item.name}"?`);
    if (!ok) return;

    setDeletingIds((prev) => new Set(prev).add(itemId));
    try {
      const response = await fetch(`/api/menu/items/${itemId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as any;
        const message =
          (typeof payload?.message === "string" && payload.message) ||
          "No se pudo eliminar el item.";
        window.alert(message);
        return;
      }

      const deletedCategoryKey = categoryKey(item.category);
      const itemIsBar = barCategoryKeySet.has(deletedCategoryKey);

      let categoryIsNowEmpty = false;
      setLocalItems((prev) => {
        const next = prev.filter((i) => i.id !== itemId);
        categoryIsNowEmpty = !next.some(
          (i) => categoryKey(i.category) === deletedCategoryKey,
        );
        return next;
      });

      if (categoryIsNowEmpty) {
        if (itemIsBar) {
          const next = customBarCategories.filter(
            (c) => categoryKey(c) !== deletedCategoryKey,
          );
          if (next.length !== customBarCategories.length) persistBarCategories(next);
        } else {
          const next = customRestauranteCategories.filter(
            (c) => categoryKey(c) !== deletedCategoryKey,
          );
          if (next.length !== customRestauranteCategories.length)
            persistRestauranteCategories(next);
        }
      }
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  return (
    <div className="rounded-2xl border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card sm:p-6">
      <div className="mb-6">
        <div className="inline-flex w-full gap-1 rounded-xl bg-gray-2 p-1 dark:bg-dark-2">
          <button
            type="button"
            onClick={() => setTab("restaurante")}
            className={
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition " +
              (tab === "restaurante"
                ? "bg-primary text-white shadow-sm"
                : "text-body hover:text-dark dark:text-dark-6 dark:hover:text-white")
            }
          >
            <RiRestaurantLine className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="xsm:hidden">Rest. </span>
            <span className="hidden xsm:inline">Restaurante </span>
            <span>({restauranteItems.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("bar")}
            className={
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition " +
              (tab === "bar"
                ? "bg-secondary text-white shadow-sm"
                : "text-body hover:text-dark dark:text-dark-6 dark:hover:text-white")
            }
          >
            <RiDrinks2Fill className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>Bar ({barItems.length})</span>
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {!readOnly ? (
          <button
            type="button"
            onClick={() => {
              if (showCreate) {
                setShowCreate(false);
                cancelEdit();
              } else {
                startCreate();
              }
            }}
            className="flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 sm:w-auto"
          >
            {showCreate ? "Cerrar" : "Agregar categoría / item"}
          </button>
        ) : null}
        <div
          className={
            "relative w-full sm:max-w-xs " +
            (!readOnly ? "sm:ml-auto" : "")
          }
        >
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tab === "bar" ? "Buscar en bar..." : "Buscar en restaurante..."}
            className="w-full rounded-md border-2 border-primary/40 bg-white py-2 pl-11 pr-3 text-sm text-dark shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-dark-3 dark:bg-gray-dark dark:text-white"
          />
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
        </div>
      </div>

      {showCreate && !readOnly && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 opacity-0 animate-[fadeIn_160ms_ease-out_forwards]"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setShowCreate(false);
            cancelEdit();
          }}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl border border-stroke bg-white p-5 shadow-2xl opacity-0 animate-[fadeIn_200ms_ease-out_60ms_forwards] dark:border-dark-3 dark:bg-gray-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-base font-semibold text-dark dark:text-white">
                {formMode === "edit" ? "Editar item" : "Crear categoría / item"}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    cancelEdit();
                  }}
                  className="rounded-xl border border-stroke bg-gray-1 px-3 py-2 text-sm font-semibold text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:bg-white/5 dark:text-white"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-dark dark:text-white">
                  Categoría
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={categoryMode}
                    onChange={(e) =>
                      setCategoryMode(e.target.value === "new" ? "new" : "existing")
                    }
                    className="w-28 rounded-xl border border-stroke bg-transparent px-3 py-2 text-xs text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:text-white"
                  >
                    <option value="existing">Existente</option>
                    <option value="new">Nueva</option>
                  </select>
                  {categoryMode === "new" ? (
                    <input
                      value={categoryNewInput}
                      onChange={(e) => setCategoryNewInput(e.target.value)}
                      placeholder="Nueva categoría"
                      className="flex-1 rounded-xl border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:text-white"
                    />
                  ) : (
                    <select
                      value={categoryInput}
                      onChange={(e) => setCategoryInput(e.target.value)}
                      className="w-52 rounded-xl border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:text-white"
                    >
                      <option value="">
                        {tab === "bar"
                          ? "Selecciona categoría (Bar)"
                          : "Selecciona categoría (Restaurante)"}
                      </option>
                      {categoryOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-dark dark:text-white">
                  Nombre
                </label>
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Nombre del item"
                  className="w-full rounded-xl border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-dark dark:text-white">
                  Precio
                </label>
                <input
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  placeholder="Ej: 18000"
                  inputMode="decimal"
                  className="w-full rounded-xl border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:text-white"
                />
              </div>

            </div>

            <div className="mt-3">
              <label className="mb-1 block text-sm font-medium text-dark dark:text-white">
                Descripción (opcional)
              </label>
              <textarea
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:text-white"
              />
            </div>

            <div className="mt-4">
              <div className="mb-2 text-sm font-semibold text-dark dark:text-white">
                Receta (obligatoria)
              </div>
              <p className="mb-2 text-xs text-body-color dark:text-dark-6">
                Indica la cantidad (peso) de cada insumo para relacionar el costo con caja, compras e inventario.
              </p>
              <div className="overflow-auto rounded-xl border border-stroke dark:border-dark-3">
                <table className="w-full text-sm">
                  <thead className="bg-gray-1 text-left text-xs font-semibold uppercase tracking-wide text-dark dark:bg-white/5 dark:text-white">
                    <tr>
                      <th className="px-3 py-2">Ingrediente</th>
                      <th className="px-3 py-2">Peso</th>
                      <th className="px-3 py-2">Precio</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipeDraft.map((row, index) => {
                      const weight = parseDecimalInput(row.weight);
                      const price = parseDecimalInput(row.price);
                      const total = weight * price;
                      return (
                        <tr key={`${row.name}-${index}`} className="border-t border-stroke dark:border-dark-3">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <select
                                value={row.name}
                                onChange={(e) => selectInventoryItem(index, e.target.value)}
                                className="w-full rounded-lg border border-stroke bg-transparent px-2 py-1 text-sm text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:text-white"
                              >
                                <option value="">Selecciona ingrediente</option>
                                {inventoryProducts.map((item) => (
                                  <option key={`${item.source}-${item.id}`} value={item.name}>
                                    {item.name}
                                  </option>
                                ))}
                              </select>
                              <span className="shrink-0 text-xs font-medium text-dark-6 dark:text-dark-6">
                                {row.unit ? row.unit.replace(/mililitros/i, "ML").replace(/gramos/i, "GR").replace(/unidades/i, "Unidad") : "-"}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={row.weight}
                              onChange={(e) => updateRecipeRow(index, "weight", e.target.value)}
                              placeholder="0"
                              inputMode="decimal"
                              className="w-full rounded-lg border border-stroke bg-transparent px-2 py-1 text-sm text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:text-white"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={row.price}
                              onChange={(e) => updateRecipeRow(index, "price", e.target.value)}
                              placeholder="0"
                              inputMode="decimal"
                              className="w-full rounded-lg border border-stroke bg-transparent px-2 py-1 text-sm text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:text-white"
                            />
                          </td>
                          <td className="px-3 py-2 font-semibold text-dark dark:text-white">
                            {formatCopPrice(total)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => removeRecipeRow(index)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stroke bg-white text-red transition hover:bg-red hover:text-white dark:border-dark-3 dark:bg-dark-2"
                              aria-label={`Eliminar ingrediente ${row.name || index + 1}`}
                            >
                              <RiDeleteBinLine className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {inventoryLoading ? (
                <p className="mt-2 text-sm text-dark-6 dark:text-dark-6">Cargando inventario...</p>
              ) : inventoryError ? (
                <p className="mt-2 text-sm text-red">{inventoryError}</p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-dark dark:text-white">
                <button
                  type="button"
                  onClick={addRecipeRow}
                  className="rounded-xl border border-stroke bg-white px-3 py-2 text-sm font-semibold text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                >
                  Agregar ingrediente
                </button>
                <div className="flex flex-wrap gap-4">
                  <span>
                    Gramaje total:{" "}
                    {new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(
                      recipeTotals.gramaje,
                    )}
                  </span>
                  <span>Total receta: {formatCopPrice(recipeTotals.costo)}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={formMode === "edit" ? handleUpdateItem : handleCreateItem}
                disabled={submitStatus.kind === "loading"}
                className={
                  "rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition " +
                  (submitStatus.kind === "loading"
                    ? "cursor-not-allowed opacity-60"
                    : "hover:bg-primary/90")
                }
              >
                {submitStatus.kind === "loading"
                  ? formMode === "edit"
                    ? "Guardando..."
                    : "Creando..."
                  : formMode === "edit"
                    ? "Guardar cambios"
                    : "Crear item"}
              </button>

              {submitStatus.kind === "error" && (
                <p className="text-sm font-medium text-red">{submitStatus.message}</p>
              )}
              {submitStatus.kind === "success" && (
                <p className="text-sm font-medium text-green">{submitStatus.message}</p>
              )}
            </div>

            <div className="mt-5">
              <div className="mb-2 text-sm font-semibold text-dark dark:text-white">
                Categorías
              </div>
              <div className="flex flex-wrap gap-2">
                {categoryOptions.map((category) => {
                  const key = categoryKey(category);
                  const count = localItems.filter((i) => categoryKey(i.category) === key)
                    .length;
                  const isCustom = customCategoryKeySet.has(key);
                  const canDelete = isCustom && count === 0;

                  return (
                    <div
                      key={category}
                      className="inline-flex items-center gap-2 rounded-xl border border-stroke bg-gray-1 px-3 py-2 text-sm text-dark dark:border-dark-3 dark:bg-white/5 dark:text-white"
                    >
                      <span className="whitespace-nowrap">{category}</span>
                      <span className="text-xs text-dark-6 dark:text-dark-6">
                        ({count})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(category)}
                        disabled={!canDelete}
                        className={
                          "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stroke bg-white text-red transition hover:bg-red hover:text-white dark:border-dark-3 dark:bg-dark-2 " +
                          (canDelete ? "" : "cursor-not-allowed opacity-50")
                        }
                        title={
                          !isCustom
                            ? "Categoría del sistema"
                            : count > 0
                              ? "Aún tiene items"
                              : "Eliminar categoría"
                        }
                        aria-label={`Eliminar categoría ${category}`}
                      >
                        <RiDeleteBinLine className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {recipeModalItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 opacity-0 animate-[fadeIn_160ms_ease-out_forwards]"
          role="dialog"
          aria-modal="true"
          onClick={closeRecipeModal}
        >
          <div
            className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-stroke bg-white p-5 shadow-2xl opacity-0 animate-[fadeIn_200ms_ease-out_60ms_forwards] dark:border-dark-3 dark:bg-gray-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-base font-semibold text-dark dark:text-white">
                Receta - {recipeModalItem.name}
              </div>
              <button
                type="button"
                onClick={closeRecipeModal}
                className="rounded-xl border border-stroke bg-gray-1 px-3 py-2 text-sm font-semibold text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:bg-white/5 dark:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="overflow-auto rounded-xl border border-stroke dark:border-dark-3">
              <table className="w-full text-sm">
                <thead className="bg-gray-1 text-left text-xs font-semibold uppercase tracking-wide text-dark dark:bg-white/5 dark:text-white">
                  <tr>
                    <th className="px-3 py-2">Ingrediente</th>
                    <th className="px-3 py-2">Peso</th>
                    <th className="px-3 py-2">Precio</th>
                    <th className="px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recipeDraft.map((row, index) => {
                    const weight = parseDecimalInput(row.weight);
                    const price = parseDecimalInput(row.price);
                    const total = weight * price;
                    return (
                      <tr key={`${row.name}-${index}`} className="border-t border-stroke dark:border-dark-3">
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-dark dark:text-white">
                              {row.name || "-"}
                            </span>
                            <span className="shrink-0 text-xs font-medium text-dark-6 dark:text-dark-6">
                              {formatUnitAbbr(row.unit) || "-"}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-sm text-dark dark:text-white">
                            {row.weight || "-"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-sm text-dark dark:text-white">
                            {row.price || "-"}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold text-dark dark:text-white">
                          {formatCopPrice(total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {inventoryLoading ? (
              <p className="mt-3 text-sm text-dark-6 dark:text-dark-6">Cargando inventario...</p>
            ) : inventoryError ? (
              <p className="mt-3 text-sm text-red">{inventoryError}</p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-dark dark:text-white">
              <div className="flex flex-wrap gap-4">
                <span>
                  Gramaje total:{" "}
                  {new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(
                    recipeTotals.gramaje,
                  )}
                </span>
                <span>Total receta: {formatCopPrice(recipeTotals.costo)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "restaurante" && (
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {RESTAURANTE_NAV.filter(({ label }) =>
              activeCategorySet.has(categoryKey(label)),
            ).map(({ label, Icon }) => {
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleCategoryNavClick(label)}
                  className={
                    "inline-flex items-center gap-2 rounded-xl border border-stroke bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-white dark:border-dark-3 dark:bg-white/5 dark:text-white dark:hover:bg-primary"
                  }
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}

            {customCategoryLabels
              .filter((label) => activeCategorySet.has(categoryKey(label)))
              .map((label) => {
              const CustomIcon = getCategoryNavIcon(label, "restaurante");
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleCategoryNavClick(label)}
                  className={
                    "inline-flex items-center gap-2 rounded-xl border border-stroke bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-white dark:border-dark-3 dark:bg-white/5 dark:text-white dark:hover:bg-primary"
                  }
                >
                  <CustomIcon className="h-5 w-5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === "bar" && (
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {BAR_NAV.filter(({ label }) => activeCategorySet.has(categoryKey(label))).map(
              ({ label, Icon }) => {
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleCategoryNavClick(label)}
                  className={
                    "inline-flex items-center gap-2 rounded-xl border border-stroke bg-secondary/10 px-3 py-2 text-sm font-semibold text-secondary transition hover:bg-secondary hover:text-white dark:border-dark-3 dark:bg-white/5 dark:text-white dark:hover:bg-secondary"
                  }
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}

            {customCategoryLabels
              .filter((label) => activeCategorySet.has(categoryKey(label)))
              .map((label) => {
              const CustomIcon = getCategoryNavIcon(label, "bar");
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleCategoryNavClick(label)}
                  className={
                    "inline-flex items-center gap-2 rounded-xl border border-stroke bg-secondary/10 px-3 py-2 text-sm font-semibold text-secondary transition hover:bg-secondary hover:text-white dark:border-dark-3 dark:bg-white/5 dark:text-white dark:hover:bg-secondary"
                  }
                >
                  <CustomIcon className="h-5 w-5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <p className="text-body text-dark-6 dark:text-dark-6">
          {searchQuery.trim()
            ? "No hay resultados para esta búsqueda."
            : "Aún no hay items en esta sección."}
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, categoryItems]) => (
            <section
              key={category}
              id={categoryToId(category)}
              className="scroll-mt-24"
            >
              <h3 className="mb-3 text-sm font-semibold tracking-wide text-dark-4 dark:text-dark-6">
                {category}
              </h3>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {categoryItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="truncate text-lg font-semibold text-dark dark:text-white">
                          {item.name}
                        </h4>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="rounded-lg bg-tertiary/20 px-3 py-1 text-sm font-semibold text-dark dark:bg-white/10 dark:text-white">
                          {formatCopPrice(item.price)}
                        </div>
                        {!readOnly ? (
                          <>
                            <Tooltip label={`Editar ${item.name}`}>
                              <button
                                type="button"
                                onClick={() => startEdit(item)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stroke bg-white text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:hover:bg-white/10"
                                aria-label={`Editar ${item.name}`}
                              >
                                <span className="sr-only">{`Editar ${item.name}`}</span>
                                <RiEdit2Line className="h-5 w-5" aria-hidden="true" />
                              </button>
                            </Tooltip>
                            <Tooltip label={`Eliminar ${item.name}`}>
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item.id)}
                                disabled={deletingIds.has(item.id)}
                                className={
                                  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stroke bg-white text-red transition hover:bg-red hover:text-white dark:border-dark-3 dark:bg-dark-2 " +
                                  (deletingIds.has(item.id)
                                    ? "cursor-not-allowed opacity-60"
                                    : "")
                                }
                                aria-label={`Eliminar ${item.name}`}
                              >
                                <span className="sr-only">{`Eliminar ${item.name}`}</span>
                                <RiDeleteBinLine className="h-5 w-5" aria-hidden="true" />
                              </button>
                            </Tooltip>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {(item.description ||
                      (item.ingredients && item.ingredients.length > 0)) && (
                      <div className="mt-3 space-y-2">
                        {item.description && (
                          <p className="text-body text-dark-6 dark:text-dark-6">
                            {item.description}
                          </p>
                        )}
                        {item.ingredients && item.ingredients.length > 0 && (
                          <p className="text-body-sm text-dark-6 dark:text-dark-6">
                            <span className="font-medium text-dark dark:text-white">
                              Ingredientes:
                            </span>{" "}
                            {getIngredientNames(item.ingredients).join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
