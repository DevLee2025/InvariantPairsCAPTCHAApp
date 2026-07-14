// Mode 2 · ERM↑ / CLIP↓ (paused, but kept functional + on the seeded RNG).
//
// For each candidate relative to the anchor:
//   dERM  = TV(ermProbs_anchor,  ermProbs_cand)
//   dCLIP = TV(clipProbs_anchor, clipProbs_cand)
//   score = dERM − λ·dCLIP        (default λ = 1)
// Rank by score, then sample `count` from the top for variety.

import type { Img, SelectArgs, SelectionMode, SelectionResult } from "../types";
import { totalVariation } from "../lib/distances";
import { sample } from "../lib/random";

const TOP_N = 24;

function ermClipScore(anchor: Img, cand: Img, lambda: number) {
  const dERM = totalVariation(anchor.ermProbs, cand.ermProbs);
  const dCLIP = totalVariation(anchor.clipProbs, cand.clipProbs);
  const score = dERM - lambda * dCLIP;
  return { dERM, dCLIP, score };
}

export const ermClip: SelectionMode = {
  id: "erm_clip",
  label: "Mode 2 · ERM↑ / CLIP↓",
  requiredFields: ["clipProbs", "ermProbs"],
  defaultParams: { lambda: 1 },
  blurb: (ctx) => {
    const lambda = ctx.params.lambda ?? 1;
    return (
      `Ranked by ERM↑ / CLIP↓: score = dERM − λ·dCLIP (λ=${lambda}), where ` +
      `dERM/dCLIP are total-variation distances between the anchor and each ` +
      `candidate. ${ctx.optionCount} sampled from the top ${TOP_N}.`
    );
  },
  select(anchor: Img, pool: Img[], { rng, count, params }: SelectArgs): SelectionResult {
    const lambda = params.lambda ?? 1;
    const scored = pool.map((cand) => {
      const { dERM, dCLIP, score } = ermClipScore(anchor, cand, lambda);
      return { cand, dERM, dCLIP, score };
    });
    scored.sort((a, b) => b.score - a.score);

    const topN = Math.min(Math.max(TOP_N, count), scored.length);
    const top = scored.slice(0, topN);
    const chosen = sample(rng, top, count);

    const scoresById: Record<string, Record<string, number>> = {};
    for (const s of chosen) {
      scoresById[s.cand.id] = { dERM: s.dERM, dCLIP: s.dCLIP, score: s.score };
    }
    return { candidates: chosen.map((s) => s.cand), scoresById };
  },
};
