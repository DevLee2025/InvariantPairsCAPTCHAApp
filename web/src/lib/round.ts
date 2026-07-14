// The pure round generator — the single source of the draw logic, shared by the
// play store (store.ts) and the reproducibility check (replay.ts). Keeping ONE
// implementation guarantees a saved seed regenerates the exact recorded game.

import type { Domain, DomainPair, Img, RNG, SelectionMode, Split } from "../types";
import { DOMAINS } from "../types";
import { buildPool, chooseAnchorDomain, resolvePartner } from "./selection";
import { pickOne } from "./random";

export interface GenRoundParams {
  rng: RNG;
  images: Img[]; // full manifest images (filtered to split inside)
  activeSplit: Split;
  mode: SelectionMode;
  pairing: DomainPair; // EFFECTIVE pairing (caller resolves any mode lock)
  gridSize: number;
  usedAnchorIds: Set<string>;
  recentlyShown: Set<string>;
}

export interface GenRoundResult {
  anchor: Img;
  options: Img[]; // ordered; index i ⇒ position i+1
  scoresById: Record<string, Record<string, number>>;
  poolSize: number;
  partnerDomain: Domain | null; // the domain candidates came from (null = mixed)
}

const MAX_ATTEMPTS = 300;

export function generateRound(p: GenRoundParams): GenRoundResult | null {
  const count = p.gridSize * p.gridSize;
  const splitImages = p.images.filter((img) => img.split === p.activeSplit);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const anchorDomain = chooseAnchorDomain(p.rng, p.pairing, DOMAINS);

    let anchorPool = splitImages.filter(
      (img) => img.domain === anchorDomain && !p.usedAnchorIds.has(img.id)
    );
    if (p.mode.requiredFields.includes("mix")) {
      anchorPool = anchorPool.filter((img) => img.mix != null);
    }
    if (anchorPool.length === 0) continue;

    const anchor = pickOne(p.rng, anchorPool);
    const partner = resolvePartner(p.rng, p.pairing, anchor.domain, DOMAINS);
    const pool = buildPool({
      rng: p.rng,
      anchor,
      images: splitImages,
      partnerDomain: partner,
      recentlyShown: p.recentlyShown,
      minNeeded: count,
    });
    if (pool.length < count) continue;

    const params = { ...(p.mode.defaultParams ?? {}) };
    const { candidates, scoresById } = p.mode.select(anchor, pool, {
      rng: p.rng,
      count,
      params,
    });
    if (candidates.length === 0) continue;

    return {
      anchor,
      options: candidates,
      scoresById,
      poolSize: pool.length,
      partnerDomain: partner,
    };
  }
  return null;
}

// Freshness ring-buffer cap — MUST match the store so replay stays in lock-step.
export const RECENT_BUFFER = 120;
