// The 42-triplet overview: 7 class rows × 6 domain-pair columns. Cells are
// heat-colored by mean CLIP cosine (most alike = green, least = amber/red)
// when triplet_stats.json is available, and show a badge once judged.

import { Fragment, useMemo } from "react";
import type {
  ClassName,
  Domain,
  Img,
  Triplet,
  TripletStat,
  TripletStatsFile,
  AnalyzerJudgment,
} from "../../types";
import { CLASSES, UNORDERED_PAIRS } from "../../types";

interface Props {
  images: Img[];
  stats: TripletStatsFile | null;
  judgments: Record<string, AnalyzerJudgment>;
  onOpen: (t: Triplet) => void;
}

const SHORT: Record<Domain, string> = {
  photo: "photo",
  art_painting: "art",
  cartoon: "cartoon",
  sketch: "sketch",
};

// Linear interpolation amber(least alike) → green(most alike), light enough
// for dark text. t in [0,1].
function heat(t: number): { bg: string; border: string } {
  const hue = 25 + t * 120; // 25 (amber) → 145 (green)
  return {
    bg: `hsl(${hue}, 80%, 91%)`,
    border: `hsl(${hue}, 55%, 78%)`,
  };
}

export function TripletGrid({ images, stats, judgments, onOpen }: Props) {
  // Train-pool size per (domain, class) — shown when stats are absent too.
  const cellCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const img of images) {
      if (img.split !== "train") continue;
      const k = `${img.domain}|${img.class}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [images]);

  const statByKey = useMemo(() => {
    const m = new Map<string, TripletStat>();
    for (const t of stats?.triplets ?? []) {
      m.set(`${t.class}|${t.domainA}|${t.domainB}`, t);
    }
    return m;
  }, [stats]);

  // Normalize meanCos across the 42 triplets for the color scale.
  const [minCos, maxCos] = useMemo(() => {
    const vals = (stats?.triplets ?? []).map((t) => t.meanCos);
    if (vals.length === 0) return [0, 1];
    return [Math.min(...vals), Math.max(...vals)];
  }, [stats]);

  const cell = (klass: ClassName, [a, b]: [Domain, Domain]) => {
    const key = `${klass}|${a}|${b}`;
    const stat = statByKey.get(key);
    const judged = judgments[key];
    const nA = stat?.nA ?? cellCounts.get(`${a}|${klass}`) ?? 0;
    const nB = stat?.nB ?? cellCounts.get(`${b}|${klass}`) ?? 0;
    const style = stat
      ? (() => {
          const t = maxCos > minCos ? (stat.meanCos - minCos) / (maxCos - minCos) : 0.5;
          const { bg, border } = heat(t);
          return { backgroundColor: bg, borderColor: border };
        })()
      : undefined;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onOpen({ class: klass, domainA: a, domainB: b })}
        style={style}
        className="relative flex min-h-[3.6rem] flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-1 py-1.5 transition hover:ring-2 hover:ring-accent"
        title={`${klass} · ${a} × ${b} — pools ${nA}×${nB}${
          stat ? ` · mean CLIP cos ${stat.meanCos.toFixed(3)}` : ""
        }`}
      >
        {stat && (
          <span className="font-mono text-sm font-semibold text-slate-800">
            {stat.meanCos.toFixed(3)}
          </span>
        )}
        <span className="text-[10px] tabular-nums text-slate-500">
          {nA}×{nB}
        </span>
        {judged && (
          <span
            className="absolute right-1 top-1 rounded-full bg-slate-800 px-1.5 py-px text-[10px] font-semibold text-white"
            title={`judged: ${judged.rating}/5${judged.note ? ` — ${judged.note}` : ""}`}
          >
            {judged.rating}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-2 overflow-auto p-1">
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `7rem repeat(${UNORDERED_PAIRS.length}, 1fr)` }}
      >
        <div />
        {UNORDERED_PAIRS.map(([a, b]) => (
          <div
            key={`${a}|${b}`}
            className="self-end pb-1 text-center text-[11px] font-medium text-slate-500"
          >
            {SHORT[a]} × {SHORT[b]}
          </div>
        ))}
        {CLASSES.map((klass) => (
          <Fragment key={klass}>
            <div className="flex items-center text-sm font-medium capitalize text-slate-700">
              {klass}
            </div>
            {UNORDERED_PAIRS.map((pair) => cell(klass, pair))}
          </Fragment>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">
        {stats
          ? "Cell color/value = mean CLIP cosine similarity of the triplet's cross-domain train pairs (green = most alike, amber = least). Click a cell to inspect pairs."
          : "Click a cell to inspect that triplet's pairs. (Run pipeline/build_triplet_stats.py for the CLIP-similarity heatmap.)"}
      </p>
    </div>
  );
}
