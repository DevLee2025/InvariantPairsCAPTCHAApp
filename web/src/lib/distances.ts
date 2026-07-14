// Distance / divergence helpers over probability vectors.

// Total variation distance between two discrete distributions: ½·Σ|p_i − q_i|.
// (SPEC §5.4, Mode 2.)
export function totalVariation(p: number[], q: number[]): number {
  const n = Math.min(p.length, q.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(p[i] - q[i]);
  return 0.5 * s;
}

// Natural log clamped away from -Infinity so a zero prob does not blow up scores.
const EPS = 1e-12;
export function safeLog(x: number): number {
  return Math.log(Math.max(x, EPS));
}
