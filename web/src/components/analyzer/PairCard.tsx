// One cross-domain pair inside a cluster: two same-class images side by side
// (A-domain left, B-domain right) with an optional ERM score badge.

import type { AnalyzerPair } from "../../lib/analyzer";
import { RetryImg } from "../RetryImg";

interface Props {
  index: number; // 1-based position in the cluster
  pair: AnalyzerPair;
  scoreLabel: string | null; // formatted by ClusterView; null in random mode
}

export function PairCard({ index, pair, scoreLabel }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2">
      <div className="grid grid-cols-2 gap-1.5">
        {[pair.a, pair.b].map((img) => (
          <figure key={img.id} className="min-w-0">
            <RetryImg
              src={img.url}
              alt={`${img.domain} · ${img.class}`}
              loading="lazy"
              className="aspect-square w-full rounded-lg border border-slate-200 object-cover"
            />
            <figcaption
              className="mt-0.5 truncate text-center text-[10px] text-slate-500"
              title={img.id}
            >
              {img.domain}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between px-0.5">
        <span className="text-[10px] tabular-nums text-slate-400">#{index}</span>
        {scoreLabel && (
          <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-600">
            {scoreLabel}
          </span>
        )}
      </div>
    </div>
  );
}
