// PACS Analyzer cluster generation (the Analyzer's analog of round.ts).
//
// A cluster is a PURE function of (seed, mode, criterion, triplet, count,
// images): it builds its own mulberry32 stream from the seed on every call and
// never touches the Play game's RNG — so Analyzer use can't desync a game in
// progress, and a judgment's provenance (seed + params) regenerates exactly the
// pairs the human saw.
//
// ERM criteria are deterministic rankings (no randomness): "reshuffling" an ERM
// cluster is a no-op by design.

import type {
  AnalyzerMode,
  ClassName,
  Domain,
  ErmCriterion,
  Img,
  Split,
} from "../types";
import { CLASSES } from "../types";
import { makeRng, sample } from "./random";
import { totalVariation } from "./distances";

export const MIN_CLUSTER = 1;
export const MAX_CLUSTER = 20;

export interface AnalyzerPair {
  a: Img; // from domainA
  b: Img; // from domainB
  score: number | null; // criterion-dependent; null in random mode
}

// All images of one (class, domain) cell, optionally restricted to a split.
// The Analyzer inspects the train split — the same pool the game collects from.
export function cellImages(
  images: Img[],
  klass: ClassName,
  domain: Domain,
  split: Split | null
): Img[] {
  return images.filter(
    (img) =>
      img.class === klass &&
      img.domain === domain &&
      (split === null || img.split === split)
  );
}

// ERM mode needs ermProbs populated (same check the mode registry uses).
export function ermAvailable(images: Img[]): boolean {
  return images.some(
    (img) => Array.isArray(img.ermProbs) && img.ermProbs.length > 0
  );
}

export interface BuildClusterArgs {
  seed: number;
  mode: AnalyzerMode;
  criterion: ErmCriterion; // ignored in random mode
  klass: ClassName;
  domainA: Domain;
  domainB: Domain;
  images: Img[];
  count: number; // requested cluster size (clamped to 1..20 and pool sizes)
  split?: Split | null; // default "train"
}

export function buildCluster(args: BuildClusterArgs): AnalyzerPair[] {
  const split = args.split === undefined ? "train" : args.split;
  const aImgs = cellImages(args.images, args.klass, args.domainA, split);
  const bImgs = cellImages(args.images, args.klass, args.domainB, split);
  const x = Math.min(
    Math.max(MIN_CLUSTER, Math.floor(args.count)),
    MAX_CLUSTER,
    aImgs.length,
    bImgs.length
  );
  if (x < 1) return [];

  if (args.mode === "random") {
    const rng = makeRng(args.seed);
    const as = sample(rng, aImgs, x);
    const bs = sample(rng, bImgs, x);
    return as.map((a, i) => ({ a, b: bs[i], score: null }));
  }

  const ci = CLASSES.indexOf(args.klass);
  const conf = (img: Img) => img.ermProbs[ci] ?? 0;

  if (args.criterion === "confident") {
    // ERM's most prototypical images of each style: sort each side by true-class
    // confidence, pair rank-k with rank-k. Score = the pair's weaker confidence.
    const as = [...aImgs].sort((p, q) => conf(q) - conf(p)).slice(0, x);
    const bs = [...bImgs].sort((p, q) => conf(q) - conf(p)).slice(0, x);
    return as.map((a, i) => ({
      a,
      b: bs[i],
      score: Math.min(conf(a), conf(bs[i])),
    }));
  }

  // divergence: |confA − confB| DESC — pairs where ERM leans on the style shortcut.
  // agreement: totalVariation(pA, pB) ASC — pairs ERM treats as the same thing.
  const divergence = args.criterion === "divergence";
  const scored: { ai: number; bi: number; s: number }[] = [];
  for (let i = 0; i < aImgs.length; i++) {
    for (let j = 0; j < bImgs.length; j++) {
      const s = divergence
        ? Math.abs(conf(aImgs[i]) - conf(bImgs[j]))
        : totalVariation(aImgs[i].ermProbs, bImgs[j].ermProbs);
      scored.push({ ai: i, bi: j, s });
    }
  }
  scored.sort(divergence ? (p, q) => q.s - p.s : (p, q) => p.s - q.s);

  // Greedy pick with distinct images on both sides.
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: AnalyzerPair[] = [];
  for (const { ai, bi, s } of scored) {
    if (usedA.has(ai) || usedB.has(bi)) continue;
    usedA.add(ai);
    usedB.add(bi);
    out.push({ a: aImgs[ai], b: bImgs[bi], score: s });
    if (out.length === x) break;
  }
  return out;
}
