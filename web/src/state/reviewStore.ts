// Review/Annotation mode state (Phase C). Loads a saved game JSON, lets a
// reviewer step through puzzles and add per-puzzle comments, runs the seed
// reproducibility check, and assembles the annotated game for export.
//
// Two sources:
//   "local"  — the original single-user file flow (offline, FSA auto-save).
//   "shared" — multi-annotator mode via server/app.py: the game lives behind a
//     share code; each annotator's comments persist server-side in their own
//     file; the annotator stays BLIND per puzzle (no selections / player note /
//     other annotators' comments) until they reveal it, and reveals are
//     recorded so blind comments are distinguishable from post-reveal ones.

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
import { upgradeGameRecord } from "../lib/upgrade";
import {
  apiGetAll,
  apiGetGame,
  apiGetOwn,
  apiPutOwn,
  apiShareGame,
  type OwnComments,
} from "../lib/api";
import { useStore } from "./store";

const USERNAME_KEY = "grit-annotator";

export type ReviewSource = "local" | "shared";

// One other annotator's comment on one puzzle (shown after reveal).
export interface OtherComment {
  annotator: string;
  comment: string;
  at: string;
  revealedAt: string | null; // null ⇒ THEY commented blind
}

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
  // Multi-select: passes when ANY selection is from the domain (noGood puzzles
  // have no selections, so they stay excluded when this filter is set).
  if (
    f.selectedDomain &&
    !p.selections.some((sel) => sel.domain === f.selectedDomain)
  )
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

  // Shared (multi-annotator) mode.
  source: ReviewSource;
  shareCode: string | null;
  username: string; // persisted in localStorage across sessions
  annotationAt: Record<number, string>; // own comment timestamps (shared)
  revealed: Record<number, string>; // puzzleIndex → own reveal ISO (permanent)
  others: Record<number, OtherComment[]>; // fetched on reveal/refresh
  netBusy: boolean;

  load: (text: string, fileName?: string) => void;
  setUsername: (u: string) => void;
  shareGame: (username: string) => Promise<void>;
  joinByCode: (code: string, username: string) => Promise<void>;
  reveal: (puzzleIndex: number) => Promise<void>;
  refreshOthers: () => Promise<void>;
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

// Case-insensitive annotator identity ("Alice" == "alice"), matching the
// server's filename slugs closely enough for self-filtering.
function sameUser(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Serialize + upload THIS annotator's comments/reveals to the server. Each
// annotator writes only their own file, so pushes never race other annotators.
async function pushOwn(get: () => ReviewState): Promise<void> {
  const { shareCode, username, annotations, annotationAt, revealed } = get();
  if (!shareCode || !username.trim()) return;
  const comments: OwnComments = {};
  const keys = new Set([
    ...Object.keys(annotations).map(Number),
    ...Object.keys(revealed).map(Number),
  ]);
  for (const pi of keys) {
    const comment = (annotations[pi] ?? "").trim();
    const revealedAt = revealed[pi] ?? null;
    if (!comment && !revealedAt) continue;
    comments[String(pi)] = {
      comment,
      at: annotationAt[pi] ?? new Date().toISOString(),
      revealedAt,
    };
  }
  await apiPutOwn(shareCode, username, comments);
}

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

  source: "local",
  shareCode: null,
  username:
    typeof localStorage !== "undefined"
      ? localStorage.getItem(USERNAME_KEY) ?? ""
      : "",
  annotationAt: {},
  revealed: {},
  others: {},
  netBusy: false,

  load(text, fileName) {
    try {
      // Normalize v2 (single-select) or v3 (multi-select) files to v3.
      const parsed = upgradeGameRecord(JSON.parse(text));
      if (!parsed) {
        set({
          error:
            "Not a valid GRIT game file (expected schemaVersion 2 or 3 with a game + puzzles).",
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
        // A fresh load is local until shared/joined (username persists).
        source: "local",
        shareCode: null,
        annotationAt: {},
        revealed: {},
        others: {},
        netBusy: false,
      });
    } catch (e) {
      set({ error: `Could not parse JSON: ${(e as Error).message}` });
    }
  },

  setUsername(u) {
    if (typeof localStorage !== "undefined") localStorage.setItem(USERNAME_KEY, u);
    set({ username: u });
  },

  // Upload the loaded game and switch to shared mode; idempotent (re-sharing
  // the same game returns its existing code). Local comments carry over.
  async shareGame(username) {
    const name = username.trim();
    const game = get().game;
    if (!game || !name) {
      set({ autoSaveMsg: "Enter an annotator name to share." });
      return;
    }
    set({ netBusy: true });
    try {
      const res = await apiShareGame(game, name);
      get().setUsername(name);
      set({
        source: "shared",
        shareCode: res.code,
        annotationFile: null, // server persistence replaces the FSA auto-save
        autoSaveMsg: res.existing
          ? `Already shared — code ${res.code}. Give it to your annotators.`
          : `Shared — code ${res.code}. Give it to your annotators.`,
      });
      await pushOwn(get); // carry any pre-share local comments to the server
    } catch (e) {
      set({ autoSaveMsg: `Share failed: ${(e as Error).message}` });
    } finally {
      set({ netBusy: false });
    }
  },

  // Join an existing shared game by code; restores this annotator's previous
  // comments AND reveal state, so rejoining continues where they left off.
  async joinByCode(code, username) {
    const name = username.trim();
    if (!name) {
      set({ error: "Enter an annotator name to join." });
      return;
    }
    set({ netBusy: true, error: null });
    try {
      const data = await apiGetGame(code);
      get().load(JSON.stringify(data.game), `shared ${data.code}`);
      if (!get().game) return; // load() already set the error
      const own = await apiGetOwn(data.code, name);
      const annotations: Record<number, string> = {};
      const annotationAt: Record<number, string> = {};
      const revealed: Record<number, string> = {};
      for (const [k, v] of Object.entries(own.comments ?? {})) {
        const pi = Number(k);
        if (v.comment) {
          annotations[pi] = v.comment;
          annotationAt[pi] = v.at;
        }
        if (v.revealedAt) revealed[pi] = v.revealedAt;
      }
      get().setUsername(name);
      set({
        source: "shared",
        shareCode: data.code,
        annotations,
        annotationAt,
        revealed,
        autoSaveMsg: `Joined ${data.code} as ${name}.`,
      });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ netBusy: false });
    }
  },

  // Permanently reveal one puzzle's responses for THIS annotator: record the
  // timestamp; in shared mode also fetch other annotators' comments and persist
  // the reveal server-side. Review starts blind in BOTH modes.
  async reveal(puzzleIndex) {
    const s = get();
    if (s.revealed[puzzleIndex]) return;
    set({
      revealed: { ...s.revealed, [puzzleIndex]: new Date().toISOString() },
    });
    if (get().source !== "shared") return; // local: reveal is view-state only
    try {
      await get().refreshOthers();
      await pushOwn(get);
    } catch (e) {
      set({ autoSaveMsg: `Reveal sync failed: ${(e as Error).message}` });
    }
  },

  // Re-fetch all annotators' comments (shown only for revealed puzzles).
  async refreshOthers() {
    const { shareCode, username } = get();
    if (!shareCode) return;
    const all = await apiGetAll(shareCode);
    const others: Record<number, OtherComment[]> = {};
    for (const rec of all) {
      if (sameUser(rec.username, username)) continue;
      for (const [k, v] of Object.entries(rec.comments ?? {})) {
        if (!v.comment) continue;
        const pi = Number(k);
        (others[pi] ??= []).push({
          annotator: rec.username,
          comment: v.comment,
          at: v.at,
          revealedAt: v.revealedAt ?? null,
        });
      }
    }
    set({ others });
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

  // Called on "Submit comment": persist the current annotations. Shared mode
  // saves to the server (this annotator's own file); local mode uses the chosen
  // FSA file (no prompt) if set, otherwise forces the file setup, or downloads
  // if the File System Access API is unavailable.
  async submitComment(puzzleIndex) {
    if (get().source === "shared") {
      set({
        annotationAt: {
          ...get().annotationAt,
          [puzzleIndex]: new Date().toISOString(),
        },
      });
      try {
        await pushOwn(get);
        set({
          autoSaveMsg: `Saved to server (${get().shareCode}) at ${new Date().toLocaleTimeString()}.`,
        });
      } catch (e) {
        set({ autoSaveMsg: `Server save failed: ${(e as Error).message}` });
      }
      return;
    }
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
    const { game, annotations, annotationAt, username, revealed } = get();
    if (!game) return null;
    const reviewerAnnotations: ReviewerAnnotation[] = Object.entries(annotations)
      .filter(([, comment]) => comment.trim().length > 0)
      .map(([puzzleIndex, comment]) => {
        const pi = Number(puzzleIndex);
        return {
          puzzleIndex: pi,
          comment,
          at: annotationAt[pi] ?? new Date().toISOString(),
          ...(username.trim() ? { annotator: username.trim() } : {}),
          // Review is blind in both modes now — reveal provenance always travels.
          revealedAt: revealed[pi] ?? null,
        };
      });
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
      source: "local",
      shareCode: null,
      annotationAt: {},
      revealed: {},
      others: {},
      netBusy: false,
    });
  },
}));

// Dev-only: expose for manual inspection / testing the review flow.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { useReviewStore: typeof useReviewStore }).useReviewStore =
    useReviewStore;
}
