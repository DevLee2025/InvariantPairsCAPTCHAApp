// "How these N were selected" panel (SPEC §8). Reads the active mode's blurb from
// the registry so adding a mode needs no change here.

import type { Domain, DomainPair, Img, ModeId, Params } from "../types";
import { pairingLabel } from "../types";
import { getMode } from "../modes";

interface Props {
  mode: ModeId;
  anchor: Img | null;
  poolSize: number;
  optionCount: number;
  params: Params;
  domainPairing: DomainPair;
  partnerDomain: Domain | null;
}

export function StrategyPanel({
  mode,
  anchor,
  poolSize,
  optionCount,
  params,
  domainPairing,
  partnerDomain,
}: Props) {
  const m = getMode(mode);
  const text = m.blurb({ anchor, poolSize, optionCount, params, domainPairing });
  return (
    <div className="flex max-h-[42%] shrink-0 flex-col overflow-auto rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        How these {optionCount} were selected
      </h2>
      <p className="text-sm leading-relaxed text-slate-700">{text}</p>
      <div className="mt-3 text-[11px] text-slate-400">
        {m.label} · {pairingLabel(m.lockedPairing ?? domainPairing)}
        {anchor ? ` · ${anchor.domain} → ${partnerDomain ?? "mixed"}` : ""} · pool{" "}
        {poolSize}
      </div>
    </div>
  );
}
