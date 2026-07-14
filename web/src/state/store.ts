// Central app state (Zustand). Models ONE reproducible game: a seeded RNG drives
// every draw, puzzles accumulate with timing + notes, and export produces the v2
// game record. In-memory only; cleared on reload (SPEC §1, §6, §7).

import { create } from "zustand";
import type {
  Domain,
  DomainPair,
  GameRecord,
  GameTiming,
  Img,
  ImgRef,
  Manifest,
  ManifestInfo,
  ModeId,
  PresetName,
  PuzzleOption,
  PuzzleRecord,
  RNG,
  SelectedOption,
  SessionConfig,
  Split,
} from "../types";
import { ALGO_VERSION } from "../types";
import { upgradeGameRecord } from "../lib/upgrade";
import { loadManifest, manifestHash } from "../lib/manifest";
import { generateRound, RECENT_BUFFER } from "../lib/round";
import { makeRng, randomSeed, uuid } from "../lib/random";
import { createInMemoryStorage } from "../lib/storage";
import { exportGameCSV, exportGameJSON } from "../lib/export";
import type { Screenshot } from "../lib/screenshot";
import { getMode, MODE_ORDER, modeAvailable } from "../modes";

export type AppView = "play" | "review" | "analyzer";

export const PRESETS: Record<PresetName, Record<ModeId, number>> = {
  dev: { cross_domain: 250, erm_clip: 250, mixture: 250 },
  production: { cross_domain: 334, erm_clip: 333, mixture: 333 },
};

const storage = createInMemoryStorage();

function toRef(img: Img): ImgRef {
  return {
    id: img.id,
    domain: img.domain,
    class: img.class,
    split: img.split,
    url: img.url,
  };
}

// A locked mode overrides the user's pairing selection.
function effectivePairing(modeId: ModeId, selected: DomainPair): DomainPair {
  const mode = getMode(modeId);
  return mode.lockedPairing ?? selected;
}

// Parse the seed-override input: a valid non-negative integer wins; else random.
function resolveSeed(seedInput: string): number {
  const t = seedInput.trim();
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  return randomSeed();
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

interface RoundData {
  anchor: Img;
  options: Img[]; // ordered; position = index + 1
  scoresById: Record<string, Record<string, number>>;
  poolSize: number;
  partnerDomain: Domain | null; // domain the candidates came from (null = mixed)
  shownAtMs: number;
  shownAtISO: string;
}

export interface AppState {
  // Manifest / loading.
  manifest: Manifest | null;
  manifestInfo: ManifestInfo | null;
  availableModes: ModeId[]; // modes whose required manifest fields are populated
  loading: boolean;
  error: string | null;

  // Top-level view (Play / Review).
  view: AppView;

  // Game config.
  seed: number; // active seed (read-only display)
  seedInput: string; // user override (blank ⇒ random next game)
  gridSize: number;
  activeSplit: Split; // which split the game draws from (req 1; default "train")
  preset: PresetName;
  session: SessionConfig;
  mode: ModeId;
  domainPairing: DomainPair;

  // Runtime.
  rng: RNG;
  gameId: string;
  sessionId: string;
  startedAtMs: number;
  startedAtISO: string;
  endedAtISO: string | null;
  counts: Record<ModeId, number>;
  usedAnchorIds: Set<string>;
  recentlyShown: string[];
  round: RoundData | null;
  puzzles: PuzzleRecord[];
  screenshots: Screenshot[]; // ordered DOM captures (req 5b)
  // Multi-select (v3): ids toggled on for the CURRENT round, in pick order,
  // plus each id's toggle-on time. Cleared on submit/advance.
  pendingSelections: string[];
  pendingPickedAt: Record<string, string>;
  capturing: boolean; // a screenshot is in flight (blocks new picks)

  // Note draft for the current (in-progress) puzzle.
  currentNote: string;
  currentFlag: boolean;

  // UI flags.
  savedOpen: boolean;
  showSwitchPrompt: boolean;
  switchTo: ModeId | null;
  sessionComplete: boolean;

  // Actions.
  init: () => Promise<void>;
  setView: (v: AppView) => void;
  newGame: (seedOverride?: number) => void;
  resumeGame: (raw: unknown) => { ok: boolean; error?: string; resumed?: number };
  setSeedInput: (s: string) => void;
  setGridSize: (n: number) => void;
  setPreset: (preset: PresetName) => void;
  setMode: (mode: ModeId) => void;
  setDomainPairing: (pair: DomainPair) => void;
  nextRound: () => void;
  toggleSelection: (candidateId: string) => void;
  // ids in pick order; [] ⇒ the player marked "no good options".
  recordSelections: (
    candidateIds: string[]
  ) => { puzzleIndex: number; shouldAdvance: boolean } | null;
  commitScreenshot: (
    puzzleIndex: number,
    shot: Screenshot | null,
    shouldAdvance: boolean
  ) => void;
  setCurrentNote: (note: string) => void;
  toggleCurrentFlag: () => void;
  updatePuzzle: (puzzleIndex: number, patch: Partial<PuzzleRecord>) => void;
  removePuzzle: (puzzleIndex: number) => void;
  clearPuzzles: () => void;
  toggleSaved: () => void;
  dismissSwitchPrompt: () => void;
  acceptSwitchPrompt: () => void;
  exportJSON: () => void;
  exportCSV: () => void;
}

// Build one round via the shared generator (same code path as replay/verify), then
// stamp the shown-at time. Pure w.r.t. (rng stream, manifest, config).
function makeRound(state: AppState): RoundData | null {
  if (!state.manifest) return null;
  const res = generateRound({
    rng: state.rng,
    images: state.manifest.images,
    activeSplit: state.activeSplit,
    mode: getMode(state.mode),
    pairing: effectivePairing(state.mode, state.domainPairing),
    gridSize: state.gridSize,
    usedAnchorIds: state.usedAnchorIds,
    recentlyShown: new Set(state.recentlyShown),
  });
  if (!res) return null;
  return {
    anchor: res.anchor,
    options: res.options,
    scoresById: res.scoresById,
    poolSize: res.poolSize,
    partnerDomain: res.partnerDomain,
    shownAtMs: Date.now(),
    shownAtISO: new Date().toISOString(),
  };
}

function emptyCounts(): Record<ModeId, number> {
  return { cross_domain: 0, erm_clip: 0, mixture: 0 };
}

export const useStore = create<AppState>((set, get) => ({
  manifest: null,
  manifestInfo: null,
  availableModes: MODE_ORDER,
  loading: true,
  error: null,

  view: "play",

  seed: 0,
  seedInput: "",
  gridSize: 3,
  activeSplit: "train",
  preset: "dev",
  session: { perModeQuota: PRESETS.dev, order: MODE_ORDER },
  mode: "cross_domain",
  domainPairing: "random_single",

  rng: makeRng(1),
  gameId: uuid(),
  sessionId: uuid(),
  startedAtMs: Date.now(),
  startedAtISO: new Date().toISOString(),
  endedAtISO: null,
  counts: emptyCounts(),
  usedAnchorIds: new Set<string>(),
  recentlyShown: [],
  round: null,
  puzzles: [],
  screenshots: [],
  pendingSelections: [],
  pendingPickedAt: {},
  capturing: false,

  currentNote: "",
  currentFlag: false,

  savedOpen: false,
  showSwitchPrompt: false,
  switchTo: null,
  sessionComplete: false,

  async init() {
    set({ loading: true, error: null });
    try {
      const manifest = await loadManifest();
      const manifestInfo: ManifestInfo = {
        version: manifest.version,
        imageCount: manifest.images.length,
        hash: manifestHash(manifest),
      };
      const availableModes = MODE_ORDER.filter((id) =>
        modeAvailable(getMode(id), manifest.images)
      );
      const firstAvailable = availableModes[0] ?? "cross_domain";
      set({
        manifest,
        manifestInfo,
        availableModes,
        mode: firstAvailable,
        loading: false,
      });
      get().newGame();
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  setView(v) {
    set({ view: v });
  },

  newGame(seedOverride?: number) {
    const seed = seedOverride ?? resolveSeed(get().seedInput);
    storage.clear();
    set({
      seed,
      rng: makeRng(seed),
      gameId: uuid(),
      startedAtMs: Date.now(),
      startedAtISO: new Date().toISOString(),
      endedAtISO: null,
      counts: emptyCounts(),
      usedAnchorIds: new Set<string>(),
      recentlyShown: [],
      puzzles: [],
      screenshots: [],
      pendingSelections: [],
      pendingPickedAt: {},
      capturing: false,
      round: null,
      currentNote: "",
      currentFlag: false,
      showSwitchPrompt: false,
      switchTo: null,
      sessionComplete: false,
    });
    get().nextRound();
  },

  // Resume a saved game: fast-forward the seeded RNG by replaying its recorded
  // rounds, restore the puzzles/counts/freshness, and continue where it left off.
  // Accepts schema v2 or v3 files (normalized to v3 by upgradeGameRecord).
  resumeGame(raw) {
    const state = get();
    const manifest = state.manifest;
    if (!manifest) return { ok: false, error: "Manifest not loaded yet." };
    const game = upgradeGameRecord(raw);
    if (!game) {
      return { ok: false, error: "Not a valid GRIT game file (schemaVersion 2 or 3)." };
    }
    const g = game.game;
    const liveHash = state.manifestInfo?.hash ?? "";
    if (g.manifest?.hash && g.manifest.hash !== liveHash) {
      return {
        ok: false,
        error: `Recorded on a different dataset (${g.manifest.hash} vs ${liveHash}) — can't resume.`,
      };
    }

    // Replay recorded rounds to advance the RNG + rebuild freshness, verifying
    // each round reproduces (same code path as play/verify).
    const rng = makeRng(g.seed);
    const usedAnchorIds = new Set<string>();
    const recentlyShown: string[] = [];
    for (const p of game.puzzles) {
      const res = generateRound({
        rng,
        images: manifest.images,
        activeSplit: g.split,
        mode: getMode(p.mode),
        pairing: p.domainPairing ?? g.domainPairing,
        gridSize: g.gridSize,
        usedAnchorIds,
        recentlyShown: new Set(recentlyShown),
      });
      if (!res || res.anchor.id !== p.anchor.id) {
        return {
          ok: false,
          error: `Could not reproduce puzzle ${p.puzzleIndex} from the seed — can't safely resume.`,
        };
      }
      usedAnchorIds.add(res.anchor.id);
      for (const o of res.options) recentlyShown.push(o.id);
      while (recentlyShown.length > RECENT_BUFFER) recentlyShown.shift();
    }

    storage.clear();
    for (const p of game.puzzles) storage.add(p);
    // Quota counts PAIRS (selections), not puzzles — a resumed old game with
    // noGood puzzles therefore shows a slightly lower count than when saved.
    const counts = emptyCounts();
    for (const p of game.puzzles) counts[p.mode] = counts[p.mode] + p.selections.length;
    const last = game.puzzles[game.puzzles.length - 1];

    set({
      seed: g.seed,
      seedInput: String(g.seed),
      rng,
      gameId: g.gameId,
      sessionId: g.sessionId,
      gridSize: g.gridSize,
      mode: last?.mode ?? g.mode,
      domainPairing: last?.domainPairing ?? g.domainPairing,
      activeSplit: g.split,
      startedAtMs: Date.parse(g.startedAt) || Date.now(),
      startedAtISO: g.startedAt,
      endedAtISO: null,
      counts,
      usedAnchorIds,
      recentlyShown,
      puzzles: storage.all(),
      screenshots: [], // screenshots aren't in the JSON; new ones start fresh
      pendingSelections: [],
      pendingPickedAt: {},
      capturing: false,
      round: null,
      currentNote: "",
      currentFlag: false,
      showSwitchPrompt: false,
      switchTo: null,
      sessionComplete: false,
      view: "play",
    });
    get().nextRound();
    return { ok: true, resumed: game.puzzles.length };
  },

  setSeedInput(s) {
    set({ seedInput: s });
  },

  setGridSize(n) {
    set({ gridSize: n });
    get().newGame(); // grid size changes the draw structure ⇒ fresh game
  },

  setPreset(preset) {
    set({
      preset,
      session: { perModeQuota: PRESETS[preset], order: MODE_ORDER },
    });
    get().newGame();
  },

  setMode(mode) {
    set({ mode, showSwitchPrompt: false, switchTo: null });
    get().nextRound();
  },

  setDomainPairing(pair) {
    set({ domainPairing: pair });
    get().nextRound();
  },

  nextRound() {
    // Pending picks refer to the outgoing round — always clear them.
    set({ round: makeRound(get()), pendingSelections: [], pendingPickedAt: {} });
  },

  // Toggle a candidate in/out of the current round's pending selections.
  toggleSelection(candidateId) {
    const state = get();
    if (state.capturing || !state.round) return;
    if (!state.round.options.some((c) => c.id === candidateId)) return;
    if (state.pendingSelections.includes(candidateId)) {
      const pendingPickedAt = { ...state.pendingPickedAt };
      delete pendingPickedAt[candidateId];
      set({
        pendingSelections: state.pendingSelections.filter((id) => id !== candidateId),
        pendingPickedAt,
      });
    } else {
      set({
        pendingSelections: [...state.pendingSelections, candidateId],
        pendingPickedAt: {
          ...state.pendingPickedAt,
          [candidateId]: new Date().toISOString(),
        },
      });
    }
  },

  // Phase 1 of a submit: record the puzzle (accurate timing) with EVERY picked
  // candidate ([] ⇒ "no good options"), and DEFER advancing so the screenshot
  // capture sees the answered board (rings come from pendingSelections).
  recordSelections(candidateIds) {
    const state = get();
    const { round, mode } = state;
    if (!round || state.capturing) return null;

    const noGood = candidateIds.length === 0;
    const positionById = new Map(round.options.map((img, i) => [img.id, i + 1]));
    const imgById = new Map(round.options.map((img) => [img.id, img]));

    const selections: SelectedOption[] = [];
    for (const id of candidateIds) {
      const img = imgById.get(id);
      const position = positionById.get(id);
      if (!img || position === undefined) return null; // stale/foreign id
      selections.push({
        ...toRef(img),
        position,
        pickedAt: state.pendingPickedAt[id] ?? new Date().toISOString(),
      });
    }
    const selectedAtMs = Date.now();

    const options: PuzzleOption[] = round.options.map((img, i) => ({
      ...toRef(img),
      position: i + 1,
    }));

    // Per-selection mode scores (empty for cross_domain).
    const selectionScores: Record<string, Record<string, number>> = {};
    for (const s of selections) {
      const sc = round.scoresById[s.id];
      if (sc && Object.keys(sc).length > 0) selectionScores[s.id] = sc;
    }

    // Legacy v2 mirrors: the FIRST pick.
    const first = selections[0] ?? null;

    const record: PuzzleRecord = {
      puzzleIndex: storage.count() + 1,
      mode,
      domainPairing: effectivePairing(mode, state.domainPairing),
      anchor: toRef(round.anchor),
      options,
      selections,
      selectionScores,
      selectedPosition: first?.position ?? 0,
      selected: first ? toRef(imgById.get(first.id)!) : null,
      noGood,
      shownAt: round.shownAtISO,
      selectedAt: new Date(selectedAtMs).toISOString(),
      durationMs: selectedAtMs - round.shownAtMs,
      reviewFlag: state.currentFlag,
      playerNote: state.currentNote.trim(),
      screenshotIndex: null, // set on commitScreenshot
      scores: first ? round.scoresById[first.id] ?? {} : {},
    };
    storage.add(record);

    // Freshness.
    const usedAnchorIds = new Set(state.usedAnchorIds);
    usedAnchorIds.add(round.anchor.id);
    const recentlyShown = state.recentlyShown.concat(
      round.options.map((c) => c.id)
    );
    while (recentlyShown.length > RECENT_BUFFER) recentlyShown.shift();

    // Quota counts PAIRS: each selection is one (anchor, selection) invariant
    // pair; "no good options" contributes 0.
    const counts = {
      ...state.counts,
      [mode]: state.counts[mode] + selections.length,
    };
    const quota = state.session.perModeQuota[mode];
    let showSwitchPrompt = false;
    let switchTo: ModeId | null = null;
    let sessionComplete = false;

    const allMet = state.session.order.every(
      (id) => counts[id] >= state.session.perModeQuota[id]
    );
    if (allMet) {
      sessionComplete = true;
    } else if (counts[mode] >= quota) {
      const order = state.session.order;
      const i0 = order.indexOf(mode);
      for (let i = 1; i <= order.length; i++) {
        const cand = order[(i0 + i) % order.length];
        if (counts[cand] < state.session.perModeQuota[cand]) {
          switchTo = cand;
          break;
        }
      }
      if (switchTo) showSwitchPrompt = true;
    }

    set({
      puzzles: storage.all(),
      usedAnchorIds,
      recentlyShown,
      counts,
      currentNote: "",
      currentFlag: false,
      showSwitchPrompt,
      switchTo,
      sessionComplete,
      capturing: true, // pendingSelections stay ringed until the capture commits
    });

    return {
      puzzleIndex: record.puzzleIndex,
      shouldAdvance: !sessionComplete && !showSwitchPrompt,
    };
  },

  // Phase 2: store the captured screenshot (if any), link it to the puzzle, clear
  // the highlight, and advance to the next anchor.
  commitScreenshot(puzzleIndex, shot, shouldAdvance) {
    const state = get();
    let screenshots = state.screenshots;
    if (shot) {
      screenshots = [...state.screenshots, shot];
      storage.update(puzzleIndex, { screenshotIndex: screenshots.length });
    }
    set({
      screenshots,
      puzzles: storage.all(),
      pendingSelections: [],
      pendingPickedAt: {},
      capturing: false,
    });
    if (shouldAdvance) get().nextRound();
  },

  setCurrentNote(note) {
    set({ currentNote: note });
  },

  toggleCurrentFlag() {
    set({ currentFlag: !get().currentFlag });
  },

  updatePuzzle(puzzleIndex, patch) {
    storage.update(puzzleIndex, patch);
    set({ puzzles: storage.all() });
  },

  removePuzzle(puzzleIndex) {
    storage.remove(puzzleIndex);
    set({ puzzles: storage.all() });
  },

  clearPuzzles() {
    storage.clear();
    set({ puzzles: storage.all() });
  },

  toggleSaved() {
    set({ savedOpen: !get().savedOpen });
  },

  dismissSwitchPrompt() {
    set({ showSwitchPrompt: false, switchTo: null });
    get().nextRound();
  },

  acceptSwitchPrompt() {
    const { switchTo } = get();
    if (switchTo) {
      set({ mode: switchTo, showSwitchPrompt: false, switchTo: null });
      get().nextRound();
    } else {
      set({ showSwitchPrompt: false });
    }
  },

  exportJSON() {
    exportGameJSON(buildGameRecord(get, set));
  },

  exportCSV() {
    exportGameCSV(buildGameRecord(get, set));
  },
}));

// Dev-only: expose the store for manual inspection and reproducibility checks.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { useStore: typeof useStore }).useStore = useStore;
}

// Assemble the v2 game record, stamping endedAt on the first export (req 7).
function buildGameRecord(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void
): GameRecord {
  const s = get();
  const endedAtISO = s.endedAtISO ?? new Date().toISOString();
  if (!s.endedAtISO) set({ endedAtISO });

  const perCaptchaMs = s.puzzles.map((p) => p.durationMs);
  const overallMs = Date.parse(endedAtISO) - s.startedAtMs;
  const averageMs =
    perCaptchaMs.length === 0
      ? null
      : Math.round(perCaptchaMs.reduce((a, b) => a + b, 0) / perCaptchaMs.length);
  const timing: GameTiming = {
    overallMs,
    averageMs,
    medianMs: median(perCaptchaMs),
    perCaptchaMs,
  };

  return {
    schemaVersion: 3,
    game: {
      gameId: s.gameId,
      sessionId: s.sessionId,
      seed: s.seed,
      algoVersion: ALGO_VERSION,
      mode: s.mode,
      domainPairing: effectivePairing(s.mode, s.domainPairing),
      gridSize: s.gridSize,
      optionCount: s.gridSize * s.gridSize,
      split: s.activeSplit,
      manifest: s.manifestInfo ?? { version: 0, imageCount: 0, hash: "" },
      startedAt: s.startedAtISO,
      endedAt: endedAtISO,
      timing,
    },
    puzzles: s.puzzles,
    reviewerAnnotations: [],
  };
}
