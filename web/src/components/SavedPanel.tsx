// Single collapsible right drawer of completed puzzles (SPEC §8). Shows each
// puzzle's anchor→selection, the selected position, flag/note, and "+N passed".
// Header has game JSON/CSV export + clear-all.

import type { PuzzleRecord } from "../types";
import { getMode } from "../modes";

interface Props {
  open: boolean;
  puzzles: PuzzleRecord[];
  screenshotCount: number;
  onClose: () => void;
  onRemove: (puzzleIndex: number) => void;
  onClear: () => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
  onExportScreenshots: () => void;
}

const CAP = 100;

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SavedPanel({
  open,
  puzzles,
  screenshotCount,
  onClose,
  onRemove,
  onClear,
  onExportJSON,
  onExportCSV,
  onExportScreenshots,
}: Props) {
  if (!open) return null;
  const shown = puzzles.slice(-CAP).reverse();
  const avg =
    puzzles.length === 0
      ? 0
      : puzzles.reduce((a, p) => a + p.durationMs, 0) / puzzles.length;
  const empty = puzzles.length === 0;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-800">
          Saved puzzles ({puzzles.length})
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close saved panel"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <button
          type="button"
          onClick={onExportJSON}
          disabled={empty}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={onExportCSV}
          disabled={empty}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={onExportScreenshots}
          disabled={screenshotCount === 0}
          title={`${screenshotCount} screenshot${screenshotCount === 1 ? "" : "s"}`}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Screenshots PDF
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={empty}
          className="ml-auto rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      {!empty && (
        <div className="border-b border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">
          avg {fmtMs(avg)} / puzzle
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {empty ? (
          <p className="p-4 text-sm text-slate-400">
            No puzzles yet. Click a candidate to save one.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((p) => (
              <li
                key={p.puzzleIndex}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-slate-400">
                  {p.puzzleIndex}
                </span>
                <img
                  src={p.anchor.url}
                  alt={`${p.anchor.domain} · ${p.anchor.class}`}
                  loading="lazy"
                  className="h-11 w-11 shrink-0 rounded border border-slate-200 object-cover"
                />
                <span className="text-slate-300">→</span>
                {p.selected ? (
                  <span className="relative h-11 w-11 shrink-0">
                    <img
                      src={p.selected.url}
                      alt={`${p.selected.domain} · ${p.selected.class}`}
                      loading="lazy"
                      className="h-11 w-11 rounded border-2 border-red-400 object-cover"
                    />
                    {p.selections.length > 1 && (
                      <span className="absolute -bottom-1 -right-1 rounded bg-red-500 px-1 text-[9px] font-semibold text-white">
                        +{p.selections.length - 1}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 text-center text-[9px] leading-tight text-slate-400">
                    no good
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-slate-700">
                    {p.noGood
                      ? "no good option"
                      : `pos ${p.selections.map((sel) => sel.position).join(",")}${
                          p.selections.length > 1 ? ` · ${p.selections.length} pairs` : ""
                        }`}{" "}
                    · {fmtMs(p.durationMs)}
                  </div>
                  <div className="flex flex-wrap gap-1 text-[10px] text-slate-400">
                    <span className="rounded bg-slate-100 px-1 py-0.5">
                      {getMode(p.mode).label.split(" · ")[0]}
                    </span>
                    <span className="rounded bg-slate-100 px-1 py-0.5">
                      +{p.options.length - p.selections.length} passed
                    </span>
                    {p.reviewFlag && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-700">
                        flagged
                      </span>
                    )}
                  </div>
                  {p.playerNote && (
                    <div className="mt-0.5 truncate text-[10px] italic text-slate-500">
                      “{p.playerNote}”
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(p.puzzleIndex)}
                  className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete puzzle"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}
        {puzzles.length > CAP && (
          <p className="px-3 py-2 text-[11px] text-slate-400">
            Showing the most recent {CAP} of {puzzles.length}. Export for the full
            set.
          </p>
        )}
      </div>
    </aside>
  );
}
