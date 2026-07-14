// Client-side JSON + CSV export of a v2 game record (SPEC §7).
// JSON is the full-fidelity artifact (replayable). CSV is one row per puzzle.

import type { GameRecord } from "../types";

export function toJSON(game: GameRecord): string {
  // Omit empty `scores` objects: an empty struct ({}) breaks downstream Parquet
  // schema inference (e.g. HuggingFace). The field is provenance-only (populated
  // by Modes 2/3) and unused in Review.
  const cleaned: GameRecord = {
    ...game,
    puzzles: game.puzzles.map((p) => {
      if (p.scores && Object.keys(p.scores).length === 0) {
        const copy = { ...p };
        delete (copy as { scores?: unknown }).scores;
        return copy;
      }
      return p;
    }),
  };
  return JSON.stringify(cleaned, null, 2);
}

// Escape a single CSV field per RFC 4180. (Also used by the Analyzer export.)
export function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// One row per puzzle; game-level fields repeated for convenience.
export function toCSV(game: GameRecord): string {
  const g = game.game;
  const header = [
    "gameId",
    "seed",
    "gridSize",
    "mode",
    "domainPairing",
    "split",
    "puzzleIndex",
    "anchor_id",
    "anchor_domain",
    "anchor_class",
    "anchor_url",
    "noGood",
    "selectedPosition",
    "selected_id",
    "selected_domain",
    "selected_class",
    "selected_url",
    "durationMs",
    "reviewFlag",
    "playerNote",
    "options",
  ];

  const rows = game.puzzles.map((p) => {
    const cells: unknown[] = [
      g.gameId,
      g.seed,
      g.gridSize,
      g.mode,
      g.domainPairing,
      g.split,
      p.puzzleIndex,
      p.anchor.id,
      p.anchor.domain,
      p.anchor.class,
      p.anchor.url,
      p.noGood,
      p.selectedPosition,
      p.selected?.id ?? "",
      p.selected?.domain ?? "",
      p.selected?.class ?? "",
      p.selected?.url ?? "",
      p.durationMs,
      p.reviewFlag,
      p.playerNote,
      p.options.map((o) => `${o.position}:${o.id}`).join("|"),
    ];
    return cells.map(csvField).join(",");
  });

  return [header.map(csvField).join(","), ...rows].join("\r\n");
}

// Trigger a client-side download.
export function downloadFile(
  filename: string,
  content: string,
  mime: string
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function exportGameJSON(game: GameRecord): void {
  downloadFile(`grit-game-${stamp()}.json`, toJSON(game), "application/json");
}

export function exportGameCSV(game: GameRecord): void {
  downloadFile(`grit-game-${stamp()}.csv`, toCSV(game), "text/csv");
}
