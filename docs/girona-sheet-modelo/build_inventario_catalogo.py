#!/usr/bin/env python3
"""
Regenera inventario_catalogo_girona.csv con las mismas columnas que la tabla de Inventario:

  Producto | Unidad | Stock | Costo unit. | Costo total

( «Costo total» = stock × costo unit., igual que en la UI. )

Fuentes:
- upsert-ingredients.mjs (cantidad y costo de referencia → costo unitario)
- seed-ingredients.mjs (nombre → unidad API: mililitros / gramos / unidades)
- upsert-*-recipes.mjs (ingredientes extra sin línea en upsert-ingredients)

Unidad en CSV: ML | GR | Unidad (como formatUnitAbbr en el front).

Ejecutar desde la raíz del repo:
  python3 docs/girona-sheet-modelo/build_inventario_catalogo.py
"""

from __future__ import annotations

import csv
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "girona-front/scripts"
OUT = Path(__file__).resolve().parent / "inventario_catalogo_girona.csv"
INGREDIENTS_MJS = SCRIPTS / "upsert-ingredients.mjs"
SEED_INGREDIENTS_MJS = SCRIPTS / "seed-ingredients.mjs"

LINE_RE = re.compile(r"^(.*?)(\d[\d,\.]*)\s+\$?\s*([\d,\.]+)\s*$")

CANON_ALIASES: dict[str, str] = {
    "aceite de oliva": "aceite oliva",
}


def normalize_key(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().strip())


def canon_key(name: str) -> str:
    k = normalize_key(name)
    return CANON_ALIASES.get(k, k)


def normalize_number_string(value: str) -> float:
    raw = value.strip().replace(" ", "").replace("$", "")
    if not raw:
        return 0.0
    if "." in raw and "," in raw:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
        return float(raw)
    parts = raw.split(",")
    if len(parts) > 1 and all(p.isdigit() for p in parts):
        if len(parts[-1]) == 3:
            raw = "".join(parts)
        elif len(parts) == 2 and len(parts[1]) <= 2:
            raw = f"{parts[0]}.{parts[1]}"
        else:
            raw = "".join(parts)
        return float(raw)
    if "," in raw:
        raw = raw.replace(",", ".")
    return float(raw)


def parse_seed_name_to_unit() -> dict[str, str]:
    text = SEED_INGREDIENTS_MJS.read_text(encoding="utf-8")
    m = re.search(r"const rawList = `([\s\S]*?)`;", text)
    if not m:
        raise RuntimeError("No se encontró rawList en seed-ingredients.mjs")
    out: dict[str, str] = {}
    for line in m.group(1).split("\n"):
        line = line.strip()
        if not line or "--" not in line:
            continue
        name_part, unit_part = [p.strip() for p in line.split("--", 1)]
        if not name_part or not unit_part:
            continue
        k = canon_key(name_part)
        u = unit_part.lower().strip()
        if u in ("mililitros", "gramos", "unidades"):
            out[k] = u
    return out


def parse_ingredients_mjs() -> list[tuple[str, float, float]]:
    text = INGREDIENTS_MJS.read_text(encoding="utf-8")
    m = re.search(r"const rawList = `([\s\S]*?)`;", text)
    if not m:
        raise RuntimeError("No se encontró rawList en upsert-ingredients.mjs")
    out: list[tuple[str, float, float]] = []
    for line in m.group(1).split("\n"):
        line = line.strip()
        if not line:
            continue
        mm = LINE_RE.match(line)
        if not mm:
            continue
        name = mm.group(1).strip()
        qty = normalize_number_string(mm.group(2))
        total = normalize_number_string(mm.group(3))
        out.append((name, qty, total))
    return out


def recipe_ingredient_names() -> set[str]:
    names: set[str] = set()
    for p in SCRIPTS.glob("upsert-*-recipes.mjs"):
        txt = p.read_text(encoding="utf-8")
        for m in re.finditer(r'name:\s*"([^"]+)"', txt):
            names.add(m.group(1).strip())
    return names


def stable_hash(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)


def heuristic_api_unit(raw: str) -> str:
    u = raw.upper()
    if any(
        k in u
        for k in [
            "PAN HAMBURGUESA",
            "PAN PERRO",
            "GALLETA",
            "CHORIZO SANT",
            "RELLENA",
            "HUEVO",
            "EMPANADAS",
            "TORTILLAS",
            "AREPA",
            "MAZORCA",
            "PLATANITOS",
            "ACHIRAS",
        ]
    ):
        return "unidades"
    if "AGUACATE" in u:
        return "unidades"
    if (
        "ACEITE" in u
        or "LECHE" in u
        or "VINAGRE" in u
        or "MAYONESA" in u
        or "CREMA DE LECHE" in u
        or "SIROPE" in u
    ):
        return "mililitros"
    return "gramos"


FIX_UNIT: dict[str, str] = {
    "AROS DE CEBOLLA": "gramos",
    "CAMARON": "gramos",
    "CAMARONES": "gramos",
}


def api_unit_for(raw: str, seed_units: dict[str, str]) -> str:
    raw_u = raw.upper()
    if raw_u in FIX_UNIT:
        return FIX_UNIT[raw_u]
    k = canon_key(raw)
    return seed_units.get(k, heuristic_api_unit(raw))


def format_unit_abbr(api_unit: str) -> str:
    u = api_unit.lower().strip()
    if u == "mililitros":
        return "ML"
    if u == "gramos":
        return "GR"
    if u == "unidades":
        return "Unidad"
    return api_unit or ""


def costo_unitario_cop(total: float, qty: float) -> int:
    if qty <= 0:
        return 0
    return int(round(total / qty))


def main() -> None:
    seed_units = parse_seed_name_to_unit()
    by_key: dict[str, dict] = {}

    for name, qty, total in parse_ingredients_mjs():
        key = canon_key(name)
        if not key:
            continue
        by_key[key] = {
            "raw": name,
            "nombre": name.strip(),
            "costo_unitario": costo_unitario_cop(total, qty),
        }

    for raw in recipe_ingredient_names():
        key = canon_key(raw)
        if not key or key in by_key:
            continue
        h = stable_hash(raw)
        cant = 5 + (h % 20)
        c_unit = 1000 + (h % 150) * 100
        tot = cant * c_unit
        by_key[key] = {
            "raw": raw,
            "nombre": raw.strip(),
            "costo_unitario": c_unit,
        }

    items = sorted(by_key.values(), key=lambda x: x["nombre"].lower())

    headers = ["Producto", "Unidad", "Stock", "Costo unit.", "Costo total"]

    stock_default = 0

    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(headers)
        for row in items:
            api_u = api_unit_for(row["raw"], seed_units)
            unidad = format_unit_abbr(api_u)
            cu = row["costo_unitario"]
            ctot = stock_default * cu
            w.writerow(
                [
                    row["nombre"],
                    unidad,
                    stock_default,
                    cu,
                    ctot,
                ]
            )

    print(f"Escrito {OUT} ({len(items)} filas).")


if __name__ == "__main__":
    main()
