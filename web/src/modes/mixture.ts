// Mode 3 · Mixture score (paused, but kept functional + on the seeded RNG).
// Locked to photo↔cartoon. PROVISIONAL formula lives in ONE function below so it
// can be swapped without a pipeline rerun (raw probs are in the manifest).

import type { Img, SelectArgs, SelectionMode, SelectionResult } from "../types";
import { CLASSES } from "../types";
import { safeLog } from "../lib/distances";
import { sample } from "../lib/random";

const TOP_N = 24;

// -----------------------------------------------------------------------------
// SWAPPABLE SCORE FUNCTION — change only this to revise Mode 3 (PI to confirm).
//   sPhoto   = log(photoHeavy[c])   − log(balanced[c])
//   sCartoon = log(cartoonHeavy[c]) − log(balanced[c])
//   S        = |sPhoto| + |sCartoon|
// -----------------------------------------------------------------------------
function mixtureScore(cand: Img, classIndex: number) {
  if (!cand.mix) return { mixture: 0, sPhoto: 0, sCartoon: 0 };
  const { balanced, photoHeavy, cartoonHeavy } = cand.mix;
  const c = classIndex;
  const sPhoto = safeLog(photoHeavy[c]) - safeLog(balanced[c]);
  const sCartoon = safeLog(cartoonHeavy[c]) - safeLog(balanced[c]);
  return { mixture: Math.abs(sPhoto) + Math.abs(sCartoon), sPhoto, sCartoon };
}

export const mixture: SelectionMode = {
  id: "mixture",
  label: "Mode 3 · Mixture score",
  requiredFields: ["mix"],
  lockedPairing: "photo↔cartoon",
  blurb: (ctx) =>
    `Locked to photo↔cartoon. Ranked by the mixture score at the anchor's ` +
    `class: S = |log photoHeavy − log balanced| + |log cartoonHeavy − log balanced|. ` +
    `${ctx.optionCount} sampled from the top ${TOP_N}. (Formula provisional.)`,
  select(anchor: Img, pool: Img[], { rng, count }: SelectArgs): SelectionResult {
    const classIndex = CLASSES.indexOf(anchor.class);
    const scored = pool.map((cand) => {
      const { mixture: m, sPhoto, sCartoon } = mixtureScore(cand, classIndex);
      return { cand, mixture: m, sPhoto, sCartoon };
    });
    scored.sort((a, b) => b.mixture - a.mixture);

    const topN = Math.min(Math.max(TOP_N, count), scored.length);
    const top = scored.slice(0, topN);
    const chosen = sample(rng, top, count);

    const scoresById: Record<string, Record<string, number>> = {};
    for (const s of chosen) {
      scoresById[s.cand.id] = {
        mixture: s.mixture,
        sPhoto: s.sPhoto,
        sCartoon: s.sCartoon,
      };
    }
    return { candidates: chosen.map((s) => s.cand), scoresById };
  },
};
