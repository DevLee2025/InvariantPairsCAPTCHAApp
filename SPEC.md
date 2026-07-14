# GRIT Invariant-Pairs Game — Technical Specification

**Status:** v1 (planning → scaffolding) · **Date:** 2026-06-23
**Owners:** Research-assistant intern (build) · PI (research direction)

A web game that crowd-sources **invariant image pairs** from the PACS dataset to feed
the **GRIT** method (Geometric Robustness via Invariant Training). An annotator is shown
one *anchor* image and nine *candidate* images and picks the one most similar to the
anchor; the chosen `(anchor, selected)` pair — same object class, different visual
domain — becomes an invariant pair. The set of difference vectors `φ(anchor) − φ(selected)`
in a frozen CLIP feature space spans the *spurious subspace* that GRIT projects out.

> The paper is explicit (Remark 2) that spurious-subspace estimation "relies critically
> on the semantic consistency of the noisy invariant pairs." Human-curated pairs are the
> high-quality `δ` source this game exists to produce.

See the paper: `../Literature/ProvableRobustnessToSpuriousCorrelationsViaInvariantDataForRobustFinetuning.pdf`
(Bai, Ji, Kim, Currie, Zhou, Inouye — Purdue + Georgia Tech). Public companion preprint:
arXiv:2505.24843 (NCM). "GRIT" is this group's name and is not otherwise public.

---

## 1. Goals & scope

**In scope (this build):**
- Front-end-only game. State is in-memory and cleared on reload.
- Three selection modes, switchable by dropdown, behind an extensible registry (more modes will be added).
- A domain-pairing control (6 pairings + random).
- Session/quota model targeting 1,000 pairs split ≈334/333/333 across the current 3 modes, with a "switch mode" prompt at each quota. A small **dev** preset for local testing.
- Saving completed pairs to a single collapsible side panel (cap 100 shown), including the 8 not-selected candidates per pair.
- JSON + CSV export now; export pipeline designed for later HuggingFace (human-viewable) + spreadsheets.
- A Phase-0 offline Python pipeline that builds the static `manifest.json` and uploads images to a CDN.

**Out of scope (later phases):** backend persistence, multi-annotator auth, live DB sync, the HF push job (designed-for, not built yet).

---

## 2. System architecture

The browser cannot run CLIP or train probes, so **all model outputs are precomputed offline
into a static manifest**. The front-end loads the manifest once and does cheap arithmetic
(≤10k rows) per anchor. Images are lazy-loaded from a CDN; their bytes never pass through
selection logic.

```
pipeline/ (Python, offline, run once)      web/ (React+Vite+TS, static SPA)
  PACS → CLIP embeds → probes → manifest      load manifest.json (once)
        → upload JPEGs to S3 + CloudFront      per "Next": random anchor → mode.select() → 9 ids
                          │                     lazy-load 10 images from CDN
                          ▼                     save pair → side panel → JSON/CSV export
                   manifest.json  ───────────►  (served as a static asset)
                   CDN (S3+CloudFront)  ──────►  <img src> only
```

**Key consequence:** the 9,991 images are never enumerated as images in the browser —
only as ~10k rows of numbers. Mode 1 needs metadata only; Modes 2 & 3 need the precomputed
probabilities. The front-end MVP (Mode 1) is therefore not blocked on the ML pipeline.

---

## 3. Data source — PACS

9,991 images · 4 domains — `photo` (1,670), `art_painting` (2,048), `cartoon` (2,344),
`sketch` (3,929) · 7 classes — `dog, elephant, giraffe, guitar, horse, house, person`.
~227×227 JPEG, ~19 KB each, ~175–190 MB total. Canonical source: HuggingFace `flwrlabs/pacs`.
On-disk layout `<domain>/<class>/<file>.jpg`; filenames are **not** uniform — do not assume a
`pic_%03d` pattern.

**Train/val/test split (required).** Every image is assigned a `split` ∈ {`train`, `val`,
`test`} **before any drawing**. The game draws anchors and candidates **only from `train`**;
val/test are held out so they never appear in collected pairs. The split is stratified per
(domain, class) cell and seeded (`pipeline/splits.py`, default 80/10/10) — deterministic and
balanced, keeping all four domains present in train for cross-domain pairing. (This is a
within-domain split, not the leave-one-domain-out DG protocol — flag to PI if LODO is wanted.)

---

## 4. Manifest schema (canonical contract)

`web` consumes this; `pipeline` produces it. One file, loaded once, served as a static asset.

```jsonc
{
  "version": 1,
  "domains": ["photo", "art_painting", "cartoon", "sketch"],
  "classes": ["dog", "elephant", "giraffe", "guitar", "horse", "house", "person"],
  "cdnBase": "https://REPLACE.cloudfront.net/pacs",
  "images": [
    {
      "id": "photo/dog/056_0001",        // stable id = "<domain>/<class>/<filename-stem>"
      "domain": "photo",
      "class": "dog",
      "split": "train",                  // "train" | "val" | "test" — game draws ONLY "train"
      "file": "photo/dog/056_0001.jpg",  // relative to cdnBase → url = `${cdnBase}/${file}`
      "clipProbs": [0.71, 0.04, ...],    // length-7, CLIP zero-shot over `classes`   (Mode 2)
      "ermProbs":  [0.66, 0.05, ...],    // length-7, ERM linear probe over `classes` (Mode 2)
      "mix": {                            // Mode 3 — present only for photo+cartoon images, else null
        "balanced":     [0.6, ...],       // length-7 probs, 50:50 photo:cartoon probe
        "photoHeavy":   [0.7, ...],       // length-7 probs, 90:10
        "cartoonHeavy": [0.4, ...]        // length-7 probs, 10:90
      }
    }
  ]
}
```

Notes:
- Probabilities (not log-probs) are stored; the front-end takes logs where needed. This keeps
  every mode-score function a swappable client-side computation — no pipeline rerun to change a formula.
- `mix` is null for `art_painting`/`sketch` (Mode 3 is photo↔cartoon only).
- Size estimate: ~9,991 × ≤35 floats ≈ 5–10 MB JSON (gzip ~2–3 MB). Acceptable as a one-time load.
- **Synthetic dev manifest:** the pipeline must also emit a `--synthetic` manifest with plausible
  random numbers and placeholder image URLs (e.g. `https://picsum.photos/seed/<id>/256`) so `web`
  runs end-to-end before real data/CDN exist.

---

## 5. Selection modes

### 5.1 Universal candidate pool
For every mode, the candidate pool for a given anchor is:

```
pool = images where  img.split  == "train"                // held-out val/test never drawn
                 and  img.class  == anchor.class           // same ground-truth label ⇒ valid invariant pair
                 and  img.domain == partnerDomain          // the other domain in the active pairing
                 and  img.id     != anchor.id
                 and  img.id     ∉ recentlyShown            // freshness
```

The anchor itself is also drawn only from `train`.

Same-class restriction guarantees label consistency (PACS ground truth); modes differ only in
how they **rank/sample 9** within the pool. If a pool has < 9 members, top up from the same
class across any non-anchor domain.

### 5.2 Domain pairing (orthogonal control)
Six unordered pairings + random: `photo↔art_painting`, `photo↔cartoon`, `photo↔sketch`,
`art_painting↔cartoon`, `art_painting↔sketch`, `cartoon↔sketch`, plus `random`. The active
pairing fixes the two domains; each round the anchor is drawn from one side, candidates from
the other. A mode may **lock** the pairing (Mode 3 locks `photo↔cartoon`).

### 5.3 Mode registry (extensibility contract)
```ts
export interface SelectionMode {
  id: string;                       // "cross_domain"
  label: string;                    // "Mode 1 · Cross-domain"
  blurb: (ctx: SelectCtx) => string;// fills the "How these 9 were selected" panel
  requiredFields: ManifestField[];  // e.g. ["clipProbs","ermProbs"] — disables mode if absent
  lockedPairing?: DomainPair;       // Mode 3 → "photo↔cartoon"
  defaultParams?: Record<string, number>;
  select(anchor: Img, pool: Img[], params: Params): Img[]; // returns exactly 9 (or pool if < 9)
}
```
The dropdown, strategy panel, and per-pair provenance all read the registry. Adding a mode =
adding one module to `web/src/modes/` and registering it. **No UI or plumbing changes.**

### 5.4 The three modes
| id | label | ranking within pool |
|----|-------|---------------------|
| `cross_domain` | Mode 1 · Cross-domain | Uniform random sample of 9. No model fields. |
| `erm_clip` | Mode 2 · ERM↑ / CLIP↓ | For each candidate: `dERM = TV(ermProbs_anchor, ermProbs_cand)`, `dCLIP = TV(clipProbs_anchor, clipProbs_cand)`; score `= dERM − λ·dCLIP` (default `λ=1`); take top 9 from top-N pool (N=24) sampled for variety. `TV` = total-variation = ½·L1. |
| `mixture` | Mode 3 · Mixture score | Default score per candidate `x`, evaluated at the anchor's class `c`: `S = |log mix.photoHeavy[c] − log mix.balanced[c]| + |log mix.cartoonHeavy[c] − log mix.balanced[c]|`; take top 9 (top-N=24 sampled). Also store the signed components for analysis. Requires `mix` (photo↔cartoon only). |

Mode 3 formula is **provisional** — because raw probs are in the manifest, the exact expression
is one line in `web/src/modes/mixture.ts` and can change without touching the pipeline. PI to confirm.

### 5.5 Freshness
Track `usedAnchorIds` (never reuse an anchor) and a short `recentlyShown` ring buffer of candidate
ids; exclude both. Modes 2/3 sample 9 from the top-24 so repeat-similar anchors still vary.

---

## 6. Session & quota model

```ts
interface SessionConfig {
  perModeQuota: Record<ModeId, number>;   // production: {cross_domain:334, erm_clip:333, mixture:333}
  order: ModeId[];                         // progression order for switch prompts
}
const PRESETS = {
  dev:        { cross_domain: 3,   erm_clip: 3,   mixture: 3   },  // 9 total, fast testing
  production: { cross_domain: 334, erm_clip: 333, mixture: 333 },  // 1000 total
};
```
- Per-mode completed counts are tracked. When `count[active] >= quota[active]`, show a **switch
  prompt** ("You've completed N {mode} pairs — switch to {next}?") advancing to the next mode in
  `order` with remaining quota.
- Manual dropdown switching is always allowed; quotas still apply per mode.
- Session **complete** when every quota is met. Show a summary + export call-to-action.
- Default preset = `dev` for local runs; `production` selectable.

---

## 7. Pair record schema & export

```jsonc
{
  "pairId": "uuid",
  "schemaVersion": 1,
  "timestamp": "2026-06-23T...Z",
  "sessionId": "uuid",
  "mode": "cross_domain",
  "domainPairing": "photo↔cartoon",        // or "random"
  "anchor":   { "id": "...", "domain": "photo",   "class": "dog", "url": "https://.../...jpg" },
  "selected": { "id": "...", "domain": "cartoon", "class": "dog", "url": "https://.../...jpg" },
  "rejected": [ /* the 8 not-selected, each {id,domain,class,url} */ ],
  "scores":   { /* mode-specific, e.g. {"dERM":0.42,"dCLIP":0.05} | {"mixture":1.2,...} | {} */ },
  "params":   { /* snapshot of mode params, e.g. {"lambda":1} */ }
}
```

**Exports:**
- **JSON** — array of records, downloaded client-side (full fidelity, including `rejected`).
- **CSV** — one row per pair: flattened `anchor_*`, `selected_*`, `mode`, `domainPairing`,
  scores; `rejected` as `rejected_ids` (pipe-joined) + `rejected_urls` (pipe-joined). URLs included
  so a human can click through.
- **HuggingFace (designed-for, Phase 3):** a Python export step reads saved records, fetches JPEGs
  from the CDN by id, and writes a `datasets` table with `Image`-typed columns (`anchor_image`,
  `selected_image`, optionally `rejected_images`) **plus** all ids/metadata. `Image` columns render
  inline in the HF viewer → pairs are human-viewable while ids remain for GRIT. Cost: anchor+selected
  ≈ 38 MB / 1,000 pairs; +8 rejected ≈ 190 MB (config flag).

All persistence sits behind a `storage` interface so in-memory → Supabase/Postgres → Sheets/HF is a
single-module swap.

---

## 8. UI / UX

Design priority: **maximize image space, minimize distractions.** See the approved mockup.

- **Top bar:** Mode dropdown · Domain-pairing dropdown (disabled/locked when the mode locks it) ·
  progress `count / quota` · "Saved (n)" toggle button.
- **Board:** left column = **square** anchor tile (PACS images are square) with the
  "How these 9 were selected" panel filling the space beneath it; right column = 3×3 candidate grid.
- **Interaction:** click a candidate → save pair (chosen + 8 rejected) → load a fresh random anchor.
- **Saved panel:** single collapsible right drawer (board expands when closed). Cap 100 shown;
  each row = anchor thumb → selected thumb, mode tag, "+8 passed" tag, delete. Header has JSON/CSV
  export + clear-all.
- **Switch prompt:** modal at quota boundaries. **Session-complete:** summary + export CTA.
- No win/lose. Accessible: alt text from `domain · class`, keyboard-selectable tiles.

---

## 9. Tech stack & repo structure

```
OTG/
  SPEC.md                      ← this file
  README.md
  web/                         ← React 18 + Vite + TypeScript + Tailwind; state via Zustand
    package.json  vite.config.ts  tsconfig.json  index.html  tailwind.config.js
    public/manifest.sample.json  ← synthetic dev manifest (committed)
    src/
      main.tsx  App.tsx  index.css
      types.ts                 ← Img, Manifest, Pair, SelectionMode, SessionConfig (shared contracts)
      lib/    manifest.ts  selection.ts  distances.ts  export.ts  storage.ts  random.ts
      state/  store.ts
      modes/  registry.ts  crossDomain.ts  ermClip.ts  mixture.ts  index.ts
      components/ TopBar.tsx AnchorPanel.tsx StrategyPanel.tsx CandidateGrid.tsx
                  CandidateTile.tsx SavedPanel.tsx SwitchPrompt.tsx SessionComplete.tsx
  pipeline/                    ← Python 3.11+, offline
    pyproject.toml (or requirements.txt)  README.md  config.py
    01_download_pacs.py  02_compute_clip.py  03_train_probes.py
    04_build_manifest.py  05_upload_cdn.py   make_synthetic_manifest.py
```

`web` depends only on a static manifest + CDN URLs — never on Python at runtime.

---

## 10. Roadmap

- **Phase 0 — Data/ML pipeline (from zero):** download PACS; CLIP embeddings + zero-shot probs;
  train ERM probe (50:50) and the three mixture probes (50:50/90:10/10:90 photo:cartoon); assign
  the stratified train/val/test split (`splits.py`); build `manifest.json`; upload JPEGs to S3 +
  CloudFront. Plus `make_synthetic_manifest.py` for dev.
- **Phase 1 — Front-end MVP (Mode 1):** board, save, side panel, dev quota, JSON/CSV export, on the synthetic manifest.
- **Phase 2 — Modes 2 & 3 + pairing control + quota progression** against the real manifest.
- **Phase 3 — Persistence + HF/spreadsheet export; scale to 1,000 pairs.**

---

## 11. Open questions (for PI; non-blocking)

1. Mode 3 exact score function (default proposed in §5.4; swappable client-side).
2. Is the 1,000-pair target per single annotator or aggregated across annotators? (Affects when
   Phase 3 needs session/annotator identity.) Current build tags every record with a `sessionId`,
   so aggregation is already supported.
3. Mode 2 default `λ` and whether the candidate pool should be widened beyond same-class.
