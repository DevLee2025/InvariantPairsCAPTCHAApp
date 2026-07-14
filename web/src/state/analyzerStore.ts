// PACS Analyzer state: which triplet is open, how clusters are drawn (mode /
// criterion / size / seed), per-triplet human judgments, and the CLIP triplet
// stats for the overview heatmap.
//
// The cluster itself is NOT stored — it is a pure function of (seed + params +
// manifest), computed with lib/analyzer.buildCluster in the components. This
// store never touches the Play game's RNG or state.

import { create } from "zustand";
import type {
  AnalyzerExportRecord,
  AnalyzerJudgment,
  AnalyzerMode,
  ErmCriterion,
  Triplet,
  TripletStatsFile,
} from "../types";
import { tripletKey } from "../types";
import { MAX_CLUSTER, MIN_CLUSTER } from "../lib/analyzer";
import { randomSeed } from "../lib/random";
import { csvField, downloadFile, stamp } from "../lib/export";
import { useStore } from "./store";

export const STATS_URL = "/triplet_stats.json";

export interface AnalyzerState {
  triplet: Triplet | null; // null ⇒ 42-cell overview
  mode: AnalyzerMode;
  criterion: ErmCriterion;
  clusterSize: number; // requested x (1..20)
  seed: number; // random-mode draw seed (ERM rankings are deterministic)
  judgments: Record<string, AnalyzerJudgment>; // tripletKey → judgment
  stats: TripletStatsFile | null;
  statsLoaded: boolean; // fetch attempted (distinguishes "loading" from "absent")

  openTriplet: (t: Triplet) => void;
  closeTriplet: () => void;
  setMode: (m: AnalyzerMode) => void;
  setCriterion: (c: ErmCriterion) => void;
  setClusterSize: (n: number) => void;
  reshuffle: () => void;
  setJudgment: (rating: AnalyzerJudgment["rating"], note: string) => void;
  clearJudgment: (key: string) => void;
  exportJSON: () => void;
  exportCSV: () => void;
  loadStats: () => Promise<void>;
}

function exportRecord(judgments: Record<string, AnalyzerJudgment>): AnalyzerExportRecord {
  const s = useStore.getState();
  return {
    schemaVersion: "analyzer-1",
    manifest: s.manifestInfo ?? { version: 0, imageCount: 0, hash: "" },
    split: "train",
    judgments: Object.values(judgments).sort((a, b) => a.key.localeCompare(b.key)),
    exportedAt: new Date().toISOString(),
  };
}

export const useAnalyzerStore = create<AnalyzerState>((set, get) => ({
  triplet: null,
  mode: "random",
  criterion: "confident",
  clusterSize: 10,
  seed: randomSeed(),
  judgments: {},
  stats: null,
  statsLoaded: false,

  openTriplet(t) {
    set({ triplet: t });
  },
  closeTriplet() {
    set({ triplet: null });
  },
  setMode(mode) {
    set({ mode });
  },
  setCriterion(criterion) {
    set({ criterion });
  },
  setClusterSize(n) {
    if (!Number.isFinite(n)) return;
    set({ clusterSize: Math.min(MAX_CLUSTER, Math.max(MIN_CLUSTER, Math.floor(n))) });
  },
  reshuffle() {
    set({ seed: randomSeed() });
  },

  // Record the judgment for the OPEN triplet, stamped with the exact draw
  // parameters in effect — so the judged cluster can be regenerated later.
  setJudgment(rating, note) {
    const { triplet, mode, criterion, seed, clusterSize, judgments } = get();
    if (!triplet) return;
    const key = tripletKey(triplet);
    const judgment: AnalyzerJudgment = {
      key,
      class: triplet.class,
      domainA: triplet.domainA,
      domainB: triplet.domainB,
      rating,
      note: note.trim(),
      mode,
      criterion: mode === "erm" ? criterion : null,
      seed,
      clusterSize,
      at: new Date().toISOString(),
    };
    set({ judgments: { ...judgments, [key]: judgment } });
  },
  clearJudgment(key) {
    const next = { ...get().judgments };
    delete next[key];
    set({ judgments: next });
  },

  exportJSON() {
    downloadFile(
      `grit-analyzer-judgments-${stamp()}.json`,
      JSON.stringify(exportRecord(get().judgments), null, 2),
      "application/json"
    );
  },

  exportCSV() {
    const header = [
      "class",
      "domainA",
      "domainB",
      "rating",
      "note",
      "mode",
      "criterion",
      "seed",
      "clusterSize",
      "at",
    ];
    const rec = exportRecord(get().judgments);
    const rows = rec.judgments.map((j) =>
      [
        j.class,
        j.domainA,
        j.domainB,
        j.rating,
        j.note,
        j.mode,
        j.criterion ?? "",
        j.seed,
        j.clusterSize,
        j.at,
      ]
        .map(csvField)
        .join(",")
    );
    downloadFile(
      `grit-analyzer-judgments-${stamp()}.csv`,
      [header.map(csvField).join(","), ...rows].join("\r\n"),
      "text/csv"
    );
  },

  // Fetch the heatmap stats once; absence (404 / pipeline not run) is fine —
  // the overview renders as a neutral grid.
  async loadStats() {
    if (get().statsLoaded) return;
    try {
      const res = await fetch(STATS_URL);
      if (!res.ok) {
        set({ stats: null, statsLoaded: true });
        return;
      }
      const parsed = (await res.json()) as TripletStatsFile;
      const ok = Array.isArray(parsed?.triplets) && parsed.triplets.length > 0;
      set({ stats: ok ? parsed : null, statsLoaded: true });
    } catch {
      set({ stats: null, statsLoaded: true });
    }
  },
}));

// Dev-only: expose for manual inspection (same pattern as the other stores).
if (import.meta.env.DEV && typeof window !== "undefined") {
  (
    window as unknown as { useAnalyzerStore: typeof useAnalyzerStore }
  ).useAnalyzerStore = useAnalyzerStore;
}
