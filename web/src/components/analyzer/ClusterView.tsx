// Drill-in view for one triplet: the cluster of x cross-domain pairs plus the
// judgment bar. The cluster is recomputed (pure) from seed + params, so what
// the reviewer sees is exactly what a judgment's provenance regenerates.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../state/store";
import { useAnalyzerStore } from "../../state/analyzerStore";
import { buildCluster } from "../../lib/analyzer";
import type { AnalyzerJudgment, ErmCriterion } from "../../types";
import { tripletKey } from "../../types";
import { PairCard } from "./PairCard";

const RATING_HINT: Record<number, string> = {
  1: "least alike",
  5: "most alike",
};

function scoreLabel(criterion: ErmCriterion, score: number | null): string | null {
  if (score === null) return null;
  if (criterion === "confident") return `conf ${score.toFixed(2)}`;
  if (criterion === "divergence") return `Δ ${score.toFixed(2)}`;
  return `TV ${score.toFixed(3)}`;
}

export function ClusterView() {
  const manifest = useStore((s) => s.manifest);
  const triplet = useAnalyzerStore((s) => s.triplet);
  const mode = useAnalyzerStore((s) => s.mode);
  const criterion = useAnalyzerStore((s) => s.criterion);
  const clusterSize = useAnalyzerStore((s) => s.clusterSize);
  const seed = useAnalyzerStore((s) => s.seed);
  const stats = useAnalyzerStore((s) => s.stats);
  const judgments = useAnalyzerStore((s) => s.judgments);
  const close = useAnalyzerStore((s) => s.closeTriplet);
  const setJudgment = useAnalyzerStore((s) => s.setJudgment);

  const key = triplet ? tripletKey(triplet) : "";
  const existing: AnalyzerJudgment | undefined = judgments[key];

  // Local draft of the judgment (committed on Save).
  const [rating, setRating] = useState<AnalyzerJudgment["rating"] | null>(null);
  const [note, setNote] = useState("");
  const [savedMsg, setSavedMsg] = useState(false);
  useEffect(() => {
    setRating(existing?.rating ?? null);
    setNote(existing?.note ?? "");
    setSavedMsg(false);
  }, [key, existing]);

  const pairs = useMemo(() => {
    if (!manifest || !triplet) return [];
    return buildCluster({
      seed,
      mode,
      criterion,
      klass: triplet.class,
      domainA: triplet.domainA,
      domainB: triplet.domainB,
      images: manifest.images,
      count: clusterSize,
    });
  }, [manifest, triplet, seed, mode, criterion, clusterSize]);

  if (!triplet) return null;
  const stat = stats?.triplets.find(
    (t) =>
      t.class === triplet.class &&
      t.domainA === triplet.domainA &&
      t.domainB === triplet.domainB
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={close}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← All triplets
        </button>
        <h2 className="text-sm font-semibold capitalize text-slate-800">
          {triplet.class}
          <span className="mx-1.5 font-normal text-slate-400">·</span>
          <span className="normal-case">
            {triplet.domainA} × {triplet.domainB}
          </span>
        </h2>
        <span className="text-xs text-slate-400">
          {pairs.length} pair{pairs.length === 1 ? "" : "s"}
          {pairs.length < clusterSize ? ` (pool-limited, asked ${clusterSize})` : ""}
        </span>
        {stat && (
          <span
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
            title={`mean CLIP cosine over all ${stat.nA}×${stat.nB} train pairs`}
          >
            mean cos {stat.meanCos.toFixed(3)}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pairs.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">No images in this triplet's train pools.</p>
        ) : (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
          >
            {pairs.map((p, i) => (
              <PairCard
                key={`${p.a.id}|${p.b.id}`}
                index={i + 1}
                pair={p}
                scoreLabel={mode === "erm" ? scoreLabel(criterion, p.score) : null}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="text-xs font-medium text-slate-600">
          How alike are these pairs?
        </span>
        <div className="flex items-center gap-1">
          {([1, 2, 3, 4, 5] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRating(r)}
              title={RATING_HINT[r]}
              className={`h-8 w-8 rounded-md border text-sm font-semibold transition ${
                rating === r
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-slate-400">1 = least alike · 5 = most</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (e.g. “sketches too abstract to match”)…"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
        />
        <button
          type="button"
          disabled={rating === null}
          onClick={() => {
            if (rating === null) return;
            setJudgment(rating, note);
            setSavedMsg(true);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {existing ? "Update judgment" : "Save judgment"}
        </button>
        {savedMsg && <span className="text-[11px] text-green-600">saved ✓</span>}
      </div>
    </div>
  );
}
