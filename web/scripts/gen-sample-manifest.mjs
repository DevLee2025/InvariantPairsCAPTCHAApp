// Generates web/public/manifest.sample.json — a synthetic dev manifest that
// conforms EXACTLY to the schema in SPEC §4, so `web` runs standalone before the
// Python pipeline exists.
//
// Contract honoured here:
//   - ~16 images per (domain, class) cell ⇒ every cell has ≥12 (9 candidates
//     always available). 4 domains × 7 classes × 16 = 448 images.
//   - clipProbs / ermProbs: random length-7 vectors normalised to sum 1, biased
//     so the image's true class has the highest mass (realistic probes).
//   - mix: 3 random normalised length-7 vectors, present ONLY for photo & cartoon
//     images; null otherwise (SPEC §4 — Mode 3 is photo↔cartoon only).
//   - cdnBase is "" → the web manifest loader derives a picsum.photos URL from
//     each id: https://picsum.photos/seed/<encoded id>/256 (see lib/manifest.ts).
//
// Run: node scripts/gen-sample-manifest.mjs   (or: npm run gen:manifest)

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "manifest.sample.json");

const DOMAINS = ["photo", "art_painting", "cartoon", "sketch"];
const CLASSES = ["dog", "elephant", "giraffe", "guitar", "horse", "house", "person"];
const PER_CELL = 80; // 80/cell × 0.8 train ⇒ 64 train/cell (supports up to 8×8=64 from one partner domain)

// Stratified per-(domain,class) split. The game draws ONLY from "train"; val/test
// are held out (SPEC §3, §5.1). 80/10/10, assigned positionally within each cell.
const SPLIT = { train: 0.8, val: 0.1 }; // test = remainder
const N_TRAIN = Math.round(PER_CELL * SPLIT.train);
const N_VAL = Math.round(PER_CELL * SPLIT.val);
function splitFor(n) {
  if (n < N_TRAIN) return "train";
  if (n < N_TRAIN + N_VAL) return "val";
  return "test";
}

// Deterministic-ish PRNG (mulberry32) so regenerating gives stable-ish data and
// the build is reproducible. Seeded constant.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260623);

// Random length-7 prob vector, normalised to sum 1, with extra mass on `boostIdx`.
function probVector(boostIdx, boost = 4) {
  const v = CLASSES.map(() => rand() + 0.01);
  if (boostIdx >= 0) v[boostIdx] += boost;
  const sum = v.reduce((s, x) => s + x, 0);
  return v.map((x) => +(x / sum).toFixed(6));
}

const images = [];
for (const domain of DOMAINS) {
  for (let ci = 0; ci < CLASSES.length; ci++) {
    const cls = CLASSES[ci];
    for (let n = 0; n < PER_CELL; n++) {
      const stem = `${String(n).padStart(4, "0")}`;
      const id = `${domain}/${cls}/${stem}`;
      const file = `${id}.jpg`;
      const hasMix = domain === "photo" || domain === "cartoon";
      images.push({
        id,
        domain,
        class: cls,
        split: splitFor(n),
        file,
        clipProbs: probVector(ci, 4),
        ermProbs: probVector(ci, 5),
        mix: hasMix
          ? {
              balanced: probVector(ci, 3),
              photoHeavy: probVector(ci, domain === "photo" ? 5 : 2),
              cartoonHeavy: probVector(ci, domain === "cartoon" ? 5 : 2),
            }
          : null,
      });
    }
  }
}

const manifest = {
  version: 1,
  domains: DOMAINS,
  classes: CLASSES,
  // Empty cdnBase ⇒ loader falls back to a picsum URL derived from id.
  cdnBase: "",
  images,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(manifest), "utf8");
console.log(
  `Wrote ${OUT} with ${images.length} images ` +
    `(${DOMAINS.length} domains × ${CLASSES.length} classes × ${PER_CELL}/cell).`
);
