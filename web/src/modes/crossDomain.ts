// Mode 1 · Cross-domain. Uniform random sample of N² same-class candidates from
// the partner domain (the pool arrives pre-tiered + seed-shuffled, so taking the
// first `count` already prefers fresh, single-partner-domain options).

import type { Img, SelectArgs, SelectionMode, SelectionResult } from "../types";

export const crossDomain: SelectionMode = {
  id: "cross_domain",
  label: "Mode 1 · Cross-domain",
  requiredFields: [],
  blurb: (ctx) =>
    `Uniform random sample of ${ctx.optionCount} same-class candidates from the ` +
    `partner domain` +
    (ctx.poolSize ? ` (pool of ${ctx.poolSize}).` : `.`) +
    ` No model scores — every valid candidate is equally likely.`,
  select(_anchor: Img, pool: Img[], { count }: SelectArgs): SelectionResult {
    const candidates = pool.slice(0, Math.min(count, pool.length));
    const scoresById: Record<string, Record<string, number>> = {};
    for (const c of candidates) scoresById[c.id] = {};
    return { candidates, scoresById };
  },
};
