"use client";

import barraSeed from "@/data/inventory-picnic-barra.json";
import cocinaSeed from "@/data/inventory-picnic-cocina.json";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const STORAGE_COCINA = "girona.inventory.picnic.cocina.v1";
const STORAGE_BARRA = "girona.inventory.picnic.barra.v1";

type Grid = string[][];

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim();
}

function toGrid(raw: unknown[][]): Grid {
  const maxCol = raw.reduce((m, r) => Math.max(m, r.length), 0);
  return raw.map((row) => {
    const cells = row.map((c) => cellToString(c));
    while (cells.length < maxCol) cells.push("");
    return cells;
  });
}

function normalizeStoredGrid(data: unknown, template: Grid): Grid {
  if (!Array.isArray(data)) return template;
  if (data.length !== template.length) return template;
  return data.map((row, ri) => {
    const t = template[ri];
    if (!t) return [];
    if (!Array.isArray(row)) return [...t];
    const out = row.map((c) => (c == null ? "" : String(c)));
    while (out.length < t.length) out.push("");
    return out.slice(0, t.length);
  });
}

function parseStored(json: string | null, template: Grid): Grid {
  if (!json) return template;
  try {
    return normalizeStoredGrid(JSON.parse(json) as unknown, template);
  } catch {
    return template;
  }
}

function downloadJson(filename: string, grid: Grid) {
  const blob = new Blob([JSON.stringify(grid, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function cellId(r: number, c: number, sheet: string) {
  return `picnic-cell-${sheet}-${r}-${c}`;
}

type SheetTableProps = {
  sheetId: string;
  grid: Grid;
  onCellChange: (r: number, c: number, v: string) => void;
  stickyHeaderRows: number;
  rowHeightRem: number;
};

function SheetTable({ sheetId, grid, onCellChange, stickyHeaderRows, rowHeightRem }: SheetTableProps) {
  const focusNeighbor = useCallback(
    (r: number, c: number, delta: number) => {
      const flatCols = grid[0]?.length ?? 0;
      if (flatCols === 0) return;
      let idx = r * flatCols + c + delta;
      const max = grid.length * flatCols;
      if (idx < 0) idx = 0;
      if (idx >= max) idx = max - 1;
      const nr = Math.floor(idx / flatCols);
      const nc = idx % flatCols;
      document.getElementById(cellId(nr, nc, sheetId))?.focus();
    },
    [grid, sheetId],
  );

  return (
    <table
      className="w-max border-collapse border border-neutral-300 text-xs dark:border-neutral-600"
      style={{ tableLayout: "fixed" }}
    >
      <tbody>
        {grid.map((row, ri) => (
          <tr
            key={ri}
            className={
              ri < stickyHeaderRows
                ? "bg-gray-100 dark:bg-gray-800"
                : ri % 2 === 0
                  ? "bg-white dark:bg-gray-dark"
                  : "bg-gray-50/80 dark:bg-gray-900/40"
            }
            style={
              ri < stickyHeaderRows
                ? {
                    position: "sticky",
                    top: `${ri * rowHeightRem}rem`,
                    zIndex: 15 + ri,
                    boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.06)",
                  }
                : undefined
            }
          >
            {row.map((cell, ci) => (
              <td
                key={ci}
                className={
                  "border border-neutral-300 p-0 align-middle dark:border-neutral-600 " +
                  (ci === 0 ? "min-w-[14rem] max-w-[20rem]" : "min-w-[4.5rem] max-w-[10rem]")
                }
              >
                <input
                  id={cellId(ri, ci, sheetId)}
                  className="box-border h-full min-h-[2.125rem] w-full bg-transparent px-1.5 py-1 text-xs text-dark outline-none ring-inset focus:bg-primary/5 focus:ring-1 focus:ring-primary dark:text-white"
                  value={cell}
                  aria-label={`Fila ${ri + 1}, columna ${ci + 1}`}
                  onChange={(e) => onCellChange(ri, ci, e.target.value)}
                  onKeyDown={(e) => {
                    const cols = row.length;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      focusNeighbor(ri, ci, e.shiftKey ? -cols : cols);
                    } else if (e.key === "Tab") {
                      e.preventDefault();
                      focusNeighbor(ri, ci, e.shiftKey ? -1 : 1);
                    }
                  }}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PicnicInventoryModule() {
  const cocinaTemplate = useMemo(() => toGrid(cocinaSeed as unknown[][]), []);
  const barraTemplate = useMemo(() => toGrid(barraSeed as unknown[][]), []);

  const [tab, setTab] = useState<"cocina" | "barra">("cocina");
  const [cocinaGrid, setCocinaGrid] = useState<Grid>(cocinaTemplate);
  const [barraGrid, setBarraGrid] = useState<Grid>(barraTemplate);
  const skipSaveCocina = useRef(true);
  const skipSaveBarra = useRef(true);

  useLayoutEffect(() => {
    setCocinaGrid(parseStored(localStorage.getItem(STORAGE_COCINA), cocinaTemplate));
    setBarraGrid(parseStored(localStorage.getItem(STORAGE_BARRA), barraTemplate));
  }, [cocinaTemplate, barraTemplate]);

  useEffect(() => {
    if (skipSaveCocina.current) {
      skipSaveCocina.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      localStorage.setItem(STORAGE_COCINA, JSON.stringify(cocinaGrid));
    }, 350);
    return () => window.clearTimeout(t);
  }, [cocinaGrid]);

  useEffect(() => {
    if (skipSaveBarra.current) {
      skipSaveBarra.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      localStorage.setItem(STORAGE_BARRA, JSON.stringify(barraGrid));
    }, 350);
    return () => window.clearTimeout(t);
  }, [barraGrid]);

  const setCocinaCell = useCallback((r: number, c: number, v: string) => {
    setCocinaGrid((g) => {
      const next = g.map((row) => [...row]);
      if (next[r]?.[c] === undefined) return g;
      next[r]![c] = v;
      return next;
    });
  }, []);

  const setBarraCell = useCallback((r: number, c: number, v: string) => {
    setBarraGrid((g) => {
      const next = g.map((row) => [...row]);
      if (next[r]?.[c] === undefined) return g;
      next[r]![c] = v;
      return next;
    });
  }, []);

  function restoreCocina() {
    if (
      !window.confirm(
        "¿Restaurar plantilla de cocina? Se borrarán los cambios guardados en este navegador.",
      )
    ) {
      return;
    }
    setCocinaGrid(cocinaTemplate);
    localStorage.removeItem(STORAGE_COCINA);
  }

  function restoreBarra() {
    if (
      !window.confirm(
        "¿Restaurar plantilla de barra? Se borrarán los cambios guardados en este navegador.",
      )
    ) {
      return;
    }
    setBarraGrid(barraTemplate);
    localStorage.removeItem(STORAGE_BARRA);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("cocina")}
          className={
            "rounded-lg px-4 py-2 text-sm font-semibold transition-colors " +
            (tab === "cocina"
              ? "bg-primary text-white"
              : "border border-stroke bg-gray-1 text-dark hover:bg-gray-2 dark:border-dark-3 dark:bg-dark-2 dark:text-white")
          }
        >
          Inventario Cocina GIRONA PICNIC
        </button>
        <button
          type="button"
          onClick={() => setTab("barra")}
          className={
            "rounded-lg px-4 py-2 text-sm font-semibold transition-colors " +
            (tab === "barra"
              ? "bg-primary text-white"
              : "border border-stroke bg-gray-1 text-dark hover:bg-gray-2 dark:border-dark-3 dark:bg-dark-2 dark:text-white")
          }
        >
          Inventario Barra GIRONA PICNIC
        </button>
      </div>

      <p className="text-xs leading-relaxed text-body-color dark:text-dark-6">
        Tabla editable estilo hoja de cálculo. Los cambios se guardan automáticamente en este navegador
        (local). Usa Tab / Mayús+Tab y Enter / Mayús+Enter para moverte entre celdas. Para respaldo,
        exporta JSON.
      </p>

      {tab === "cocina" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={restoreCocina}
              className="rounded-md border border-stroke px-3 py-1.5 text-xs font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              Restaurar plantilla cocina
            </button>
            <button
              type="button"
              onClick={() => downloadJson("inventario-cocina-picnic.json", cocinaGrid)}
              className="rounded-md border border-stroke px-3 py-1.5 text-xs font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              Exportar JSON
            </button>
          </div>
          <div className="max-h-[min(78vh,52rem)] overflow-auto rounded-lg border border-stroke dark:border-dark-3">
            <SheetTable
              sheetId="cocina"
              grid={cocinaGrid}
              onCellChange={setCocinaCell}
              stickyHeaderRows={4}
              rowHeightRem={2.125}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={restoreBarra}
              className="rounded-md border border-stroke px-3 py-1.5 text-xs font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              Restaurar plantilla barra
            </button>
            <button
              type="button"
              onClick={() => downloadJson("inventario-barra-picnic.json", barraGrid)}
              className="rounded-md border border-stroke px-3 py-1.5 text-xs font-semibold text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              Exportar JSON
            </button>
          </div>
          <div className="max-h-[min(78vh,52rem)] overflow-auto rounded-lg border border-stroke dark:border-dark-3">
            <SheetTable
              sheetId="barra"
              grid={barraGrid}
              onCellChange={setBarraCell}
              stickyHeaderRows={1}
              rowHeightRem={2.125}
            />
          </div>
        </div>
      )}
    </div>
  );
}
