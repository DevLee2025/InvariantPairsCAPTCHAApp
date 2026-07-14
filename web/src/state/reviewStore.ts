// Review/Annotation mode state (Phase C). Loads a saved game JSON, lets a
// reviewer step through puzzles and add per-puzzle comments, runs the seed
// reproducibility check, and assembles the annotated game for export.

import { create } from "zustand";
import type {
  ClassName,
  Domain,
  GameRecord,
  PuzzleRecord,
  ReviewerAnnotation,
} from "../types";
import { verifyGame, type VerifyResult } from "../lib/replay";
import { toJSON, downloadFile } from "../lib/export";
import { useStore } from "./store";

// Minimal shape of a File System Access API handle (Chromium). Avoids depending on
// the exact DOM lib version.
type SaveFileHandle = {
  name: string;
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

function hasFsa(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showSaveFilePicker?: unknown })
      .showSaveFilePicker === "function"
  );
}

async function writeHandle(handle: SaveFileHandle, text: string): Promise<void> {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

function annotationsFromGame(game: GameRecord): Record<number, string> {
  const map: Record<number, string> = {};
  for (const a of game.reviewerAnnotations ?? []) map[a.puzzleIndex] = a.comment;
  return map;
}

function isGameRecord(x: unknown): x is GameRecord {
  if (!x || typeof x !== "object") return false;
  const g = x as Partial<GameRecord>;
  return (
    g.schemaVersion === 2 &&
    !!g.game &&
    Array.isArray(g.puzzles)
  );
}

// Review filters. ALL active filters are AND-combined (each one narrows the pool).
// Marker booleans require that trait; the class / anchor-domain / selected-domain
// dropdowns pin a triplet ("" = any); the choice-time range is a bound.
export interface ReviewFilters {
  noGood: boolean;
  flagged: boolean;
  commented: boolean; // player left a note
  klass: ClassName | ""; // "" = any class
  anchorDomain: Domain | ""; // "" = any
  selectedDomain: Domain | ""; // "" = any (excludes noGood puzzles when set)
  minMs: number;
  maxMs: number;
}

function puzzlePasses(p: PuzzleRecord, f: ReviewFilters): boolean {
  if (f.noGood && !p.noGood) return false;
  if (f.flagged && !p.reviewFlag) return false;
  if (f.commented && p.playerNote.trim().length === 0) return false;
  if (f.klass && p.anchor.class !== f.klass) return false;
  if (f.anchorDomain && p.anchor.domain !== f.anchorDomain) return false;
  if (f.selectedDomain && (!p.selected || p.selected.domain !== f.selectedDomain))
    return false;
  return p.durationMs >= f.minMs && p.durationMs <= f.maxMs;
}

// Rounded to 100 ms so the slider bounds are tidy; lo ≤ every duration ≤ hi so
// the default (full) range shows all puzzles.
function durationBoundsOf(puzzles: PuzzleRecord[]): { minMs: number; maxMs: number } {
  if (puzzles.length === 0) return { minMs: 0, maxMs: 1000 };
  const ds = puzzles.map((p) => p.durationMs);
  const lo = Math.floor(Math.min(...ds) / 100) * 100;
  const hi = Math.max(lo + 100, Math.ceil(Math.max(...ds) / 100) * 100);
  return { minMs: lo, maxMs: hi };
}

export interface ReviewState {
  game: GameRecord | null;
  fileName: string | null;
  error: string | null;
  index: number; // 0-based current puzzle (index into game.puzzles)
  annotations: Record<number, string>; // puzzleIndex → reviewer comment
  verify: VerifyResult | null;
  verifying: boolean;
  annotationFile: SaveFileHandle | null; // crash-safe auto-save target (Chromium)
  autoSaveMsg: string | null;
  filters: ReviewFilters;
  durationBounds: { minMs: number; maxMs: number }; // slider bounds for this game

  load: (text: string, fileName?: string) => void;
  setIndex: (i: number) => void;
  next: () => void;
  prev: () => void;
  setFilters: (patch: Partial<ReviewFilters>) => void;
  getFiltered: () => number[];
  setAnnotation: (puzzleIndex: number, comment: string) => void;
  chooseAnnotationFile: () => Promise<void>;
  submitComment: (puzzleIndex: number) => Promise<void>;
  runVerify: () => void;
  annotatedGame: () => GameRecord | null;
  reset: () => void;
}

const NO_FILTERS: ReviewFilters = {
  noGood: false,
  flagged: false,
  commented: false,
  klass: "",
  anchorDomain: "",
  selectedDomain: "",
  minMs: 0,
  maxMs: 0,
};

export const useReviewStore = create<ReviewState>((set, get) => ({
  game: null,
  fileName: null,
  error: null,
  index: 0,
  annotations: {},
  verify: null,
  verifying: false,
  annotationFile: null,
  autoSaveMsg: null,
  filters: NO_FILTERS,
  durationBounds: { minMs: 0, maxMs: 0 },

  load(text, fileName) {
    try {
      const parsed = JSON.parse(text);
      if (!isGameRecord(parsed)) {
        set({
          error:
            "Not a valid GRIT game file (expected schemaVersion 2 with a game + puzzles).",
        });
        return;
      }
      if (parsed.puzzles.length === 0) {
        set({ error: "This game has no puzzles.", game: null });
        return;
      }
      const bounds = durationBoundsOf(parsed.puzzles);
      set({
        game: parsed,
        fileName: fileName ?? null,
        error: null,
        index: 0,
        annotations: annotationsFromGame(parsed),
        verify: null,
        verifying: false,
        annotationFile: null,
        autoSaveMsg: null,
        durationBounds: bounds,
        filters: { ...NO_FILTERS, minMs: bounds.minMs, maxMs: bounds.maxMs },
      });
    } catch (e) {
      set({ error: `Could not parse JSON: ${(e as Error).message}` });
    }
  },

  setIndex(i) {
    const game = get().game;
    if (!game) return;
    const clamped = Math.max(0, Math.min(i, game.puzzles.length - 1));
    set({ index: clamped });
  },
  // next/prev step to the next/previous puzzle that passes the active filters.
  next() {
    const game = get().game;
    if (!game) return;
    const f = get().filters;
    for (let i = get().index + 1; i < game.puzzles.length; i++) {
      if (puzzlePasses(game.puzzles[i], f)) return set({ index: i });
    }
  },
  prev() {
    const game = get().game;
    if (!game) return;
    const f = get().filters;
    for (let i = get().index - 1; i >= 0; i--) {
      if (puzzlePasses(game.puzzles[i], f)) return set({ index: i });
    }
  },

  setFilters(patch) {
    const game = get().game;
    const filters = { ...get().filters, ...patch };
    if (filters.minMs > filters.maxMs) {
      // whichever the user just moved wins; clamp the other to keep min ≤ max
      if ("minMs" in patch) filters.maxMs = filters.minMs;
      else filters.minMs = filters.maxMs;
    }
    let index = get().index;
    if (game && game.puzzles[index] && !puzzlePasses(game.puzzles[index], filters)) {
      const first = game.puzzles.findIndex((p) => puzzlePasses(p, filters));
      if (first >= 0) index = first;
    }
    set({ filters, index });
  },

  getFiltered() {
    const game = get().game;
    if (!game) return [];
    const f = get().filters;
    const out: number[] = [];
    game.puzzles.forEach((p, i) => {
      if (puzzlePasses(p, f)) out.push(i);
    });
    return out;
  },

  setAnnotation(puzzleIndex, comment) {
    set({ annotations: { ...get().annotations, [puzzleIndex]: comment } });
  },

  // Pick a persistent file to auto-save annotations to (Chromium File System
  // Access API). After the one-time grant, submits write without re-prompting.
  async chooseAnnotationFile() {
    const game = get().game;
    if (!game) return;
    if (!hasFsa()) {
      set({
        autoSaveMsg:
          "This browser can't auto-save to a file; each submit will re-download the annotations JSON.",
      });
      return;
    }
    try {
      const picker = (
        window as unknown as {
          showSaveFilePicker: (o: unknown) => Promise<SaveFileHandle>;
        }
      ).showSaveFilePicker;
      const handle = await picker({
        suggestedName: `grit-annotations-${game.game.gameId.slice(0, 8)}.json`,
        types: [
          { description: "JSON", accept: { "application/json": [".json"] } },
        ],
      });
      const annotated = get().annotatedGame();
      if (annotated) await writeHandle(handle, toJSON(annotated));
      set({
        annotationFile: handle,
        autoSaveMsg: `Auto-saving annotations to ${handle.name}.`,
      });
    } catch {
      // user cancelled the picker — leave as-is
    }
  },

  // Called on "Submit comment": persist the current annotations. Uses the chosen
  // file (no prompt) if set; otherwise forces the file setup, or downloads if the
  // File System Access API is unavailable.
  async submitComment(puzzleIndex) {
    const annotated = get().annotatedGame();
    if (!annotated) return;
    const handle = get().annotationFile;
    if (handle) {
      try {
        await writeHandle(handle, toJSON(annotated));
        set({
          autoSaveMsg: `Saved comment for puzzle ${puzzleIndex} → ${handle.name} at ${new Date().toLocaleTimeString()}.`,
        });
      } catch (e) {
        set({
          autoSaveMsg: `Auto-save failed (${(e as Error).message}). Re-choose the annotation file.`,
          annotationFile: null,
        });
      }
    } else if (hasFsa()) {
      await get().chooseAnnotationFile(); // first submit forces the file setup + writes
    } else {
      downloadFile(
        `grit-annotations-${annotated.game.gameId.slice(0, 8)}.json`,
        toJSON(annotated),
        "application/json"
      );
      set({ autoSaveMsg: "Downloaded annotations (browser can't auto-save)." });
    }
  },

  runVerify() {
    const game = get().game;
    if (!game) return;
    const manifest = useStore.getState().manifest;
    if (!manifest) {
      set({
        verify: {
          status: "unavailable",
          checkedPuzzles: 0,
          totalPuzzles: game.puzzles.length,
          reason: "manifest not loaded yet — open Play once, then retry",
        },
      });
      return;
    }
    set({ verifying: true });
    // Defer so the "checking…" state can paint before the (sync) compute.
    setTimeout(() => {
      const result = verifyGame(game, manifest);
      set({ verify: result, verifying: false });
    }, 20);
  },

  annotatedGame() {
    const { game, annotations } = get();
    if (!game) return null;
    const reviewerAnnotations: ReviewerAnnotation[] = Object.entries(annotations)
      .filter(([, comment]) => comment.trim().length > 0)
      .map(([puzzleIndex, comment]) => ({
        puzzleIndex: Number(puzzleIndex),
        comment,
        at: new Date().toISOString(),
      }));
    return { ...game, reviewerAnnotations };
  },

  reset() {
    set({
      game: null,
      fileName: null,
      error: null,
      index: 0,
      annotations: {},
      verify: null,
      verifying: false,
      annotationFile: null,
      autoSaveMsg: null,
      filters: NO_FILTERS,
      durationBounds: { minMs: 0, maxMs: 0 },
    });
  },
}));

// Dev-only: expose for manual inspection / testing the review flow.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { useReviewStore: typeof useReviewStore }).useReviewStore =
    useReviewStore;
}
