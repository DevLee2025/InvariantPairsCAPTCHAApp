// PACS Analyzer view: top bar (mode / criterion / cluster size / seed /
// exports) over either the 42-triplet overview or one triplet's cluster.

import { useEffect, useMemo } from "react";
import { useStore } from "../../state/store";
import { useAnalyzerStore } from "../../state/analyzerStore";
import { ermAvailable } from "../../lib/analyzer";
import type { AnalyzerMode, ErmCriterion } from "../../types";
import { ERM_CRITERIA, UNORDERED_PAIRS, CLASSES } from "../../types";
import { TripletGrid } from "./TripletGrid";
import { ClusterView } from "./ClusterView";

const TOTAL_TRIPLETS = CLASSES.length * UNORDERED_PAIRS.length; // 42

export function AnalyzerView() {
  const manifest = useStore((s) => s.manifest);
  const loading = useStore((s) => s.loading);
  const a = useAnalyzerStore();

  useEffect(() => {
    void useAnalyzerStore.getState().loadStats();
  }, []);

  const ermOk = useMemo(
    () => (manifest ? ermAvailable(manifest.images) : false),
    [manifest]
  );
  const judgedCount = Object.keys(a.judgments).length;

  const modeBtn = (m: AnalyzerMode, label: string) => {
    const disabled = m === "erm" && !ermOk;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => a.setMode(m)}
        title={disabled ? "Needs ML data — run the pipeline (02/03 + merge)" : undefined}
        className={`rounded-md px-2.5 py-1 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
          a.mode === m
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-500 hover:text-slate-800"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-0.5">
          {modeBtn("random", "Random")}
          {modeBtn("erm", "ERM")}
        </div>

        {a.mode === "erm" && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Criterion
            <select
              value={a.criterion}
              onChange={(e) => a.setCriterion(e.target.value as ErmCriterion)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
            >
              {ERM_CRITERIA.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Pairs
          <input
            type="number"
            min={1}
            max={20}
            value={a.clusterSize}
            onChange={(e) => a.setClusterSize(Number(e.target.value))}
            className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
            aria-label="Cluster size (1–20 pairs)"
          />
        </label>

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="font-mono text-[11px] text-slate-400">seed {a.seed}</span>
          <button
            type="button"
            onClick={a.reshuffle}
            disabled={a.mode === "erm"}
            title={
              a.mode === "erm"
                ? "ERM rankings are deterministic — reshuffle only affects Random mode"
                : "Draw a fresh random cluster"
            }
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reshuffle
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-500">
            <span className="font-semibold text-slate-800">{judgedCount}</span>
            <span className="text-slate-400"> / {TOTAL_TRIPLETS} judged</span>
          </span>
          <button
            type="button"
            onClick={a.exportJSON}
            disabled={judgedCount === 0}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={a.exportCSV}
            disabled={judgedCount === 0}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {loading || !manifest ? (
          <div className="flex h-full items-center justify-center text-slate-400">
            Loading manifest…
          </div>
        ) : a.triplet ? (
          <ClusterView />
        ) : (
          <TripletGrid
            images={manifest.images}
            stats={a.stats}
            judgments={a.judgments}
            onOpen={a.openTriplet}
          />
        )}
      </main>
    </div>
  );
}
