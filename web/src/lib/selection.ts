// Universal candidate-pool construction + domain-pairing helpers.
// See SPEC §5.1 (pool, train-only) and §5.2 (pairing). All randomness is seeded.
//
// The pool is mode-independent: every mode receives the same pool and only
// differs in how it ranks/samples options from it (implemented in src/modes/*).
//
// Train-only filtering and the freshness/recently-shown exclusions are applied by
// the caller (store) before/around buildPool — buildPool itself just tiers the
// images it is given so that taking the first N prefers fresh, single-partner-
// domain options and only falls back to other domains when a grid is large.

import type { Domain, DomainPair, Img, RNG } from "../types";
import { shuffle } from "./random";

// Parse "a↔b" into its two domains. The "random" variants return null (the
// anchor domain is free).
export function pairDomains(pair: DomainPair): [Domain, Domain] | null {
  if (pair === "random" || pair === "random_single") return null;
  const [a, b] = pair.split("↔") as [Domain, Domain];
  return [a, b];
}

// Given the anchor's domain and the active pairing, return the partner domain.
// "random" / "random_single" → null (any non-anchor domain).
export function partnerDomain(
  pair: DomainPair,
  anchorDomain: Domain
): Domain | null {
  const ds = pairDomains(pair);
  if (!ds) return null;
  const [a, b] = ds;
  return anchorDomain === a ? b : a;
}

// Resolve the partner domain for a round (seeded). Differs from partnerDomain
// only for "random_single", which picks ONE random non-anchor domain per round
// (so all candidates share a single domain that re-rolls each anchor).
//   fixed pairing   → the other side
//   "random"        → null (mixed: any non-anchor domain)
//   "random_single" → one randomly-chosen non-anchor domain
export function resolvePartner(
  rng: RNG,
  pair: DomainPair,
  anchorDomain: Domain,
  allDomains: Domain[]
): Domain | null {
  if (pair === "random_single") {
    const others = allDomains.filter((d) => d !== anchorDomain);
    if (others.length === 0) return null;
    return others[Math.floor(rng() * others.length)];
  }
  return partnerDomain(pair, anchorDomain);
}

// Choose the anchor's domain for a round given the active pairing (seeded).
//   fixed pairing → one of the two sides; random → any of the 4 domains.
export function chooseAnchorDomain(
  rng: RNG,
  pair: DomainPair,
  allDomains: Domain[]
): Domain {
  const ds = pairDomains(pair);
  if (ds) return ds[rng() < 0.5 ? 0 : 1];
  return allDomains[Math.floor(rng() * allDomains.length)];
}

export interface PoolArgs {
  rng: RNG;
  anchor: Img;
  images: Img[]; // already filtered to the active split by the caller
  partnerDomain: Domain | null; // null ⇒ any non-anchor domain (random pairing)
  recentlyShown: Set<string>;
  minNeeded: number; // gridSize²
}

// Build a tiered, within-tier-shuffled candidate pool. Taking the first
// `minNeeded` prefers (1) fresh partner-domain, then (2) any partner-domain
// (relaxing freshness), then (3) same class in any non-anchor domain.
// Same class throughout ⇒ every option is a valid invariant pair.
export function buildPool({
  rng,
  anchor,
  images,
  partnerDomain,
  recentlyShown,
  minNeeded,
}: PoolArgs): Img[] {
  const sameClass = images.filter(
    (img) => img.class === anchor.class && img.id !== anchor.id
  );

  const inPartner = (img: Img) =>
    partnerDomain === null
      ? img.domain !== anchor.domain
      : img.domain === partnerDomain;

  const tier1 = sameClass.filter(
    (img) => inPartner(img) && !recentlyShown.has(img.id)
  );

  const pool: Img[] = shuffle(rng, tier1);
  const have = new Set(pool.map((i) => i.id));

  if (pool.length < minNeeded) {
    // Tier 2: relax freshness within the partner domain.
    const tier2 = sameClass.filter(
      (img) => inPartner(img) && !have.has(img.id)
    );
    for (const img of shuffle(rng, tier2)) {
      pool.push(img);
      have.add(img.id);
    }
  }

  if (pool.length < minNeeded) {
    // Tier 3: same class, any non-anchor domain (large grids on small cells).
    const tier3 = sameClass.filter(
      (img) => img.domain !== anchor.domain && !have.has(img.id)
    );
    for (const img of shuffle(rng, tier3)) {
      pool.push(img);
      have.add(img.id);
    }
  }

  return pool;
}
