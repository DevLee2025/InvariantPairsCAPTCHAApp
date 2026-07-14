# GRIT Invariant-Pairs — Migration Note

_Snapshot for picking the project up cleanly. See `SPEC.md` for the original design
(some v2 details below supersede it) and `README.md` for run instructions._

## What this is
A web tool to crowd-source **invariant image pairs** from PACS (same object class,
different visual domain) to feed the PI's **GRIT** method. Two working modes today —
**Play** (collect pairs) and **Review/Annotate** (inspect + peer-review a saved game).
A third mode, **PACS Analyzer**, is planned (see Pending).

## Stack & layout
- **Front-end:** React 18 + Vite + TypeScript + Tailwind + Zustand. `web/`.
- **Pipeline:** Python 3.11+. `pipeline/`.
- Front-end depends only on a static `manifest.json` + local images — never on Python at runtime.

```
OTG/
  SPEC.md  README.md  MIGRATION.md
  web/  (npm run dev → http://localhost:5173)
    src/
      types.ts                       # ALL shared contracts (manifest, GameRecord v2, filters)
      state/store.ts                 # Play store (Zustand); resumeGame; window.useStore in DEV
      state/reviewStore.ts           # Review store; filters; annotation auto-save; window.useReviewStore in DEV
      lib/round.ts                   # generateRound() — THE shared draw logic (store + replay use it)
      lib/{selection,random}.ts      # pools/pairing (resolvePartner); seeded mulberry32 RNG
      lib/{manifest,export}.ts        # load manifest + resolve urls; JSON/CSV export
      lib/{screenshot,pdf}.ts         # html2canvas capture (timeout-guarded); screenshots PDF (jsPDF)
      lib/{replay,reviewPdf}.ts       # verifyGame (seed check); annotation PDF
      modes/{registry,crossDomain,ermClip,mixture}.ts
      components/  App.tsx GlobalNav PlayView TopBar AnchorPanel StrategyPanel
                   CandidateGrid CandidateTile SavedPanel SwitchPrompt SessionComplete
                   RetryImg  review/{ReviewView,ReviewBoard}
    public/manifest.json              # REAL PACS metadata (gitignored, ~1.5MB)
    public/pacs/**                    # REAL PACS jpgs (gitignored, ~190MB, served /pacs/...)
    public/manifest.sample.json       # synthetic fallback (committed; SVG placeholder tiles)
    vite.config.ts                    # server.watch.ignored: public/pacs (see Gotchas)
  pipeline/
    build_real_manifest.py            # DONE-run: PACS → web/public/pacs + manifest.json (metadata only)
    splits.py                         # stratified per-(domain,class) 80/10/10 split
    build_hf_dataset.py               # saved game JSON(s) → HF parquet (embedded images)
    01–05*.py  make_synthetic_manifest.py  config.py   # full ML pipeline (02 CLIP, 03 probes) — AUTHORED, NOT RUN
```

## Data contracts
**Manifest** `{version, domains[4], classes[7], cdnBase, images:[{id:"<domain>/<class>/<stem>",
domain, class, split:"train|val|test", file, clipProbs:[], ermProbs:[], mix:null, url}]}`.
Real manifest: `cdnBase:"/pacs"`, `clipProbs`/`ermProbs` **empty** (Modes 2/3 paused). `url` resolved at
load (empty cdnBase ⇒ offline SVG placeholder). Content `hash` (FNV-1a) pins the dataset.

**GameRecord (schemaVersion 2)** — one replayable game:
`{schemaVersion:2, game:{gameId,sessionId, seed, algoVersion, mode, domainPairing, gridSize,
optionCount, split, manifest:{version,imageCount,hash}, startedAt,endedAt, timing:{overallMs,
averageMs,medianMs,perCaptchaMs}}, puzzles:[{puzzleIndex, mode, domainPairing, anchor,
options:[{...,position}], selectedPosition, selected|null, noGood, shownAt, selectedAt, durationMs,
reviewFlag, playerNote, screenshotIndex, scores}], reviewerAnnotations:[]}`.
`selected:null`/`noGood:true`/`selectedPosition:0` ⇒ player chose "no good options".

## Key decisions
- **Reproducibility:** one seeded mulberry32 RNG per game; `generateRound()` is the *single* draw path
  used by both Play and `verifyGame`/`resumeGame` — so seed + manifest reproduces a game exactly.
- **Train-only draws:** anchors + candidates come only from `split==="train"`; val/test held out.
- **Same-origin images (no CDN yet):** served from `web/public/pacs` so html2canvas screenshots work.
- **Modes 2 & 3 (ERM/CLIP) PAUSED:** auto-disabled in the UI while their manifest fields are empty.
  Mode 1 (Cross-domain) is the only active selection mode.
- **Pairing:** 6 fixed domain-pairs + `random` (mixed 3 non-anchor domains) + `random_single`
  (one random non-anchor domain, re-rolled per round). **Default = `random_single`.**
- **Presets:** `dev` = 250 pairs/mode; `production` = 334/333/333 (=1000).
- **HF dataset:** commit the **parquet** from `build_hf_dataset.py` (one row/pair, embedded
  anchor+selected images) — NOT the raw game JSON (that's one row + breaks Parquet).

## Current status — built & verified
- **Play:** seeded/replayable; grid 2×2–8×8; per-puzzle + overall/avg/median timing; player note +
  "Flag for review"; **"No good options"** button; per-pick screenshot; JSON/CSV + Screenshots PDF;
  **Load game** (resume a saved JSON — replays RNG to continue seamlessly; screenshots not restored).
- **Review:** load JSON; numbered grid, red-bordered pick, player note; **reviewer comments** with
  **crash-safe auto-save** (File System Access API, Chromium) via "Submit comment"; **seed-verify**;
  **filters** (AND-combined: No-good / Flagged / Player-commented + class / anchor-domain /
  selected-domain dropdowns + choice-time range); Annotation PDF; Save annotated JSON.
- **Phase 0 (real PACS):** 9,991 images on disk (photo 1670 / art 2048 / cartoon 2344 / sketch 3929),
  80/10/10 split (train 7993), min 64 train/cell.

## Pending / next
1. **PACS Analyzer (3rd mode) — planned, NOT built.** Overview heatmap of the 42 triplets
   (7 classes × 6 domain-pairs) → drill into a cluster of ≤20 cross-domain pairs; Random + ERM
   selection. **4 open decisions:** (a) ERM pair criterion — confident-exemplars vs ERM-agreement
   (recommended) vs ERM-divergence; (b) add CLIP-cosine similarity + overview heatmap (recommended);
   (c) record/export per-triplet human judgments?; (d) green-light the ML run. Random mode needs no ML.
2. **Run the ML pipeline** (`02_compute_clip` + `03_train_probes`; fix: `02` reads `pipeline/data/raw`
   but images are in `web/public/pacs`) → populate `ermProbs` (+ keep 512-d CLIP embeddings). This
   un-pauses Play Modes 2/3 AND enables Analyzer ERM mode. ~2 GB torch install, ~20–40 min CPU pass.
3. **Shared hosting** (S3 + CloudFront) for multi-annotator use — needs CORS for screenshots. Deferred.
4. **Persistence / backend** and scale toward the 1,000-pair goal. Deferred.

## Gotchas
- **Dev server:** run `npm run dev` in your OWN terminal for long collection runs (tool-launched
  previews can be session-bound). `vite.config.ts` already ignores `public/pacs` in the watcher —
  without that the server died mid-run (~90 puzzles) on Windows file-handle pressure.
- **Data recovery:** exports are 100% client-side — if the server dies, open Saved → Export JSON
  before reloading (in-memory only).
- **Seed-verify** reports mismatch if you change Mode/Pairing mid-game via the dropdown (an extra draw
  is consumed). Grid/preset/seed changes start a fresh game, so they're fine.
- **HMR desync** after many source edits → restart the preview server for a clean module graph.
- `web/public/pacs` + `web/public/manifest.json` are gitignored; `npm run build` copies them into
  `dist/` (~190 MB) — use `npm run dev` for local play.
