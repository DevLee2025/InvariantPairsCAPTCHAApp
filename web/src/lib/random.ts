// Seeded random helpers. ALL game-path randomness flows through a single seeded
// RNG so a game is fully reproducible from its seed (SPEC reproducibility).

import type { RNG } from "../types";

// mulberry32 — small, fast, seedable PRNG. Same seed ⇒ same sequence.
export function makeRng(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick a fresh 32-bit seed. This is the ONLY use of Math.random in the game path:
// it seeds the deterministic stream; everything downstream is reproducible.
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

export function randInt(rng: RNG, n: number): number {
  return Math.floor(rng() * n);
}

export function pickOne<T>(rng: RNG, arr: T[]): T {
  return arr[randInt(rng, arr.length)];
}

// Fisher–Yates shuffle (returns a new array; does not mutate input).
export function shuffle<T>(rng: RNG, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Sample up to `k` distinct items (seeded).
export function sample<T>(rng: RNG, arr: readonly T[], k: number): T[] {
  if (k >= arr.length) return shuffle(rng, arr);
  return shuffle(rng, arr).slice(0, k);
}

// UUID v4 for identifiers (gameId/sessionId/puzzle ids). NOT part of the seeded
// draw stream — identifiers are allowed to be non-deterministic.
export function uuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
