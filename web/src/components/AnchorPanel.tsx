// Left column: square anchor tile + the strategy panel beneath it (SPEC §8).
// The anchor is a self-fitting square (container queries) so it never overflows;
// the strategy panel is height-capped and scrolls, so neither spills onto the
// note bar below.

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
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
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
  );
}
