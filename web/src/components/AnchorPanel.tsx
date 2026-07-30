// Left column: square anchor tile + the strategy panel beneath it (SPEC §8).
// Responsive: On mobile (<1024px), renders a sleek compact horizontal banner so the
// CandidateGrid gets maximum screen real estate. On desktop (≥1024px), renders
// the full square anchor tile and strategy panel.

import type { Domain, DomainPair, Img, ModeId, Params } from "../types";
import { StrategyPanel } from "./StrategyPanel";

interface Props {
  anchor: Img | null;
  mode: ModeId;
  poolSize: number;
  optionCount: number;
  params: Params;
  domainPairing: DomainPair;
  partnerDomain: Domain | null;
}

export function AnchorPanel({
  anchor,
  mode,
  poolSize,
  optionCount,
  params,
  domainPairing,
  partnerDomain,
}: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-2 lg:h-full lg:min-h-0 lg:gap-3">
      {/* Mobile Compact Anchor Banner (<1024px) */}
      <div className="flex items-center gap-3 rounded-xl border-2 border-accent bg-slate-50 p-2 shadow-sm lg:hidden">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {anchor ? (
            <img
              src={anchor.url}
              alt={`${anchor.domain} · ${anchor.class}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-slate-400">
              None
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
              Anchor
            </span>
            <span className="text-xs font-semibold text-slate-700 capitalize truncate">
              {anchor ? `${anchor.domain} · ${anchor.class}` : "No anchor"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500 truncate">
            Find matching {anchor?.class ?? "objects"} in partner domain ({partnerDomain ?? "mixed"})
          </p>
        </div>
      </div>

      {/* Desktop Full Anchor Panel (≥1024px) */}
      <div className="hidden lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-3">
        <div
          className="flex min-h-0 flex-1 items-center justify-center"
          style={{ containerType: "size" }}
        >
          <div
            className="relative overflow-hidden rounded-xl border-2 border-accent bg-slate-50 shadow-sm"
            style={{ width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)" }}
          >
            {anchor ? (
              <>
                <img
                  src={anchor.url}
                  alt={`${anchor.domain} · ${anchor.class}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                  draggable={false}
                />
                <span className="absolute left-2 top-2 rounded bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
                  anchor · {anchor.domain} · {anchor.class}
                </span>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                No anchor
              </div>
            )}
          </div>
        </div>
        <StrategyPanel
          mode={mode}
          anchor={anchor}
          poolSize={poolSize}
          optionCount={optionCount}
          params={params}
          domainPairing={domainPairing}
          partnerDomain={partnerDomain}
        />
      </div>
    </div>
  );
}
