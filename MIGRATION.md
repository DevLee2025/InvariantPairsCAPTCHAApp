# GRIT Invariant-Pairs — Migration Note

_Snapshot for picking the project up cleanly. See `SPEC.md` for the original design
(some v2 details below supersede it) and `README.md` for run instructions._

## What this is
A web tool to crowd-source **invariant image pairs** from PACS (same object class,
different visual domain) to feed the PI's **GRIT** method. Three working views —
**Play** (collect pairs), **Review/Annotate** (inspect + peer-review a saved game),
and **PACS Analyzer** (judge which of the 42 class×domain-pair triplets produce
the most/least alike pairs).

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
      lib/analyzer.ts                 # Analyzer clusters — pure fn of seed+params, own RNG
      state/analyzerStore.ts          # Analyzer state + judgments; window.useAnalyzerStore in DEV
      modes/{registry,crossDomain,ermClip,mixture}.ts
      components/  App.tsx GlobalNav PlayView TopBar AnchorPanel StrategyPanel
                   CandidateGrid CandidateTile SavedPanel SwitchPrompt SessionComplete
                   RetryImg  review/{ReviewView,ReviewBoard}
                   analyzer/{AnalyzerView,TripletGrid,ClusterView,PairCard}
    public/manifest.json              # REAL PACS metadata + CLIP/ERM/mix probs (gitignored, ~3MB)
    public/triplet_stats.json         # 42-triplet CLIP-cosine stats (gitignored; build_triplet_stats.py)
    public/pacs/**                    # REAL PACS jpgs (gitignored, ~190MB, served /pacs/...)
    public/manifest.sample.json       # synthetic fallback (committed; SVG placeholder tiles)
    vite.config.ts                    # server.watch.ignored: public/pacs (see Gotchas)
  server/                             # multi-annotator Review API (FastAPI, 127.0.0.1:8787)
    app.py  requirements.txt          # share codes; per-annotator files under server/data/ (gitignored)
  pipeline/
    build_real_manifest.py            # DONE-run: PACS → web/public/pacs + manifest.json (metadata only)
    splits.py                         # stratified per-(domain,class) 80/10/10 split
    build_hf_dataset.py               # saved game JSON(s) → HF parquet (embedded images)
    build_triplet_stats.py            # DONE-run: 42-triplet CLIP-cosine stats → web/public
    merge_probs_into_manifest.py      # DONE-run: inject 02/03 probs into web manifest (hash-safe)
    01–05*.py  make_synthetic_manifest.py  config.py   # ML pipeline — 02+03 RUN 2026-07-13 (XPU, ~3 min)
```

## Data contracts
**Manifest** `{version, domains[4], classes[7], cdnBase, images:[{id:"<domain>/<class>/<stem>",
domain, class, split:"train|val|test", file, clipProbs:[], ermProbs:[], mix:null, url}]}`.
Real manifest: `cdnBase:"/pacs"`, `clipProbs`/`ermProbs`/`mix` **POPULATED** (merged 2026-07-13 by
`merge_probs_into_manifest.py`; Modes 2/3 un-paused). `url` resolved at load (empty cdnBase ⇒ offline
SVG placeholder). Content `hash` (FNV-1a over version + ordered ids ONLY) pins the dataset — merging
probs did NOT change it, so pre-merge saved games still verify/resume.

**Analyzer judgments (schemaVersion "analyzer-1")** — `{schemaVersion, manifest:{version,imageCount,
hash}, split, judgments:[{key:"class|domA|domB", class, domainA, domainB, rating:1–5 (1=least alike),
note, mode, criterion|null, seed, clusterSize, at}], exportedAt}` (+ flat CSV). A judgment's
seed+params regenerate the exact judged cluster via `lib/analyzer.buildCluster`.

**GameRecord (schemaVersion 3 — multi-select)** — one replayable game:
`{schemaVersion:3, game:{gameId,sessionId, seed, algoVersion, mode, domainPairing, gridSize,
optionCount, split, manifest:{version,imageCount,hash}, startedAt,endedAt, timing:{overallMs,
averageMs,medianMs,perCaptchaMs}}, puzzles:[{puzzleIndex, mode, domainPairing, anchor,
options:[{...,position}], selections:[{...,position,pickedAt}], selectionScores{id→scores},
selectedPosition, selected|null, noGood, shownAt, selectedAt, durationMs, reviewFlag, playerNote,
screenshotIndex, scores}], reviewerAnnotations:[]}`.
`selections` (pick order) is CANONICAL — each entry is one invariant pair; empty + `noGood:true` ⇒
"no good options". `selected`/`selectedPosition`/`scores` are legacy mirrors of the FIRST pick so
v2-era tooling still reads v3 files. **v2 files auto-upgrade on load** (`lib/upgrade.ts` — used by
Review, resume, verify, and the HF builder); saving/annotating re-emits them as v3. Quota counts
PAIRS (Σ selections; noGood adds 0 — so a resumed v2 game with noGood puzzles shows a slightly
lower count than when saved). CSV = one row per (anchor, selection) with `selection_rank`/
`n_selections`/`picked_at`; HF parquet likewise (`pair_id = gameId#puzzleIndex#p<position>`).
Player choices never touch the seeded RNG ⇒ algoVersion stays 1 and old seeds replay unchanged.

**ReviewerAnnotation (multi-annotator, additive)**: `{puzzleIndex, comment, at, annotator?,
revealedAt?}` — `annotator` names who wrote it; `revealedAt` (shared mode) is when that annotator
revealed the puzzle's responses (`null` ⇒ never revealed; `comment.at < revealedAt` ⇒ the comment
was written blind). Server-side, each annotator's comments live in
`server/data/<CODE>/annotations/<user>.json` (usernames case-insensitive), the uploaded game is
never mutated, and `GET /api/games/<code>/export` returns the merged attributed record.

## Key decisions
- **Reproducibility:** one seeded mulberry32 RNG per game; `generateRound()` is the *single* draw path
  used by both Play and `verifyGame`/`resumeGame` — so seed + manifest reproduces a game exactly.
- **Train-only draws:** anchors + candidates come only from `split==="train"`; val/test held out.
- **Same-origin images (no CDN yet):** served from `web/public/pacs` so html2canvas screenshots work.
- **Modes 2 & 3 UN-PAUSED (2026-07-13):** the ML pipeline ran (CLIP ViT-B/32 embeddings + logistic
  probes on frozen features, fit train-split-only; ERM probe acc train .978 / val .972) and probs were
  merged into the manifest. Availability stays auto-detected from manifest fields.
- **Analyzer isolation:** an Analyzer cluster is a pure function of (seed, mode, criterion, triplet,
  size) with its own RNG — Analyzer use can never desync an in-progress game. ERM rankings are
  deterministic (Reshuffle only affects Random mode).
- **Pairing:** 6 fixed domain-pairs + `random` (mixed 3 non-anchor domains) + `random_single`
  (one random non-anchor domain, re-rolled per round). **Default = `random_single`.**
- **Presets:** `dev` = 250 pairs/mode; `production` = 334/333/333 (=1000).
- **HF dataset:** commit the **parquet** from `build_hf_dataset.py` (one row/pair, embedded
  anchor+selected images) — NOT the raw game JSON (that's one row + breaks Parquet).

## Current status — built & verified
- **Play:** seeded/replayable; grid 2×2–8×8; **multi-select (2026-07-14)** — toggle any number of
  options, submit with "Save N pairs" ("No good options" disabled while picks exist); per-puzzle +
  overall/avg/median timing; player note + "Flag for review"; per-submit screenshot (all picks
  ringed); JSON/CSV + Screenshots PDF; **Load game** (resume a saved v2/v3 JSON — replays RNG to
  continue seamlessly; screenshots not restored). Submit tolerates rAF-throttled background tabs.
- **Review:** load JSON; numbered grid, red-bordered picks, player note; **reviewer comments** with
  **crash-safe auto-save** (File System Access API, Chromium) via "Submit comment"; **seed-verify**;
  **filters** (AND-combined: No-good / Flagged / Player-commented + class / anchor-domain /
  selected-domain dropdowns + choice-time range); Annotation PDF; Save annotated JSON.
- **Shared multi-annotator Review (2026-07-14):** run `server/app.py` (or `npm run api`), then
  "Share for annotators…" → 6-char code; others "Join with a code" + username (persisted in
  localStorage, case-insensitive identity). Per-puzzle **annotator blindness**: selections + player
  note/flag + other annotators' comments hidden until "Show responses" (permanent, timestamped,
  stored with the annotator's comments — blind vs post-reveal comments are distinguishable);
  the four leaky filters are disabled in shared mode; comments persist server-side per annotator
  (async-independent by construction); rejoin restores comments + reveal state; exports (JSON/PDF)
  merge all annotators, attributed. LAN: `npm run dev -- --host`, share the Vite URL (`/api`
  proxies to the local server). Blindness is honest-path only (lab-trust; no auth).
- **Phase 0 (real PACS):** 9,991 images on disk (photo 1670 / art 2048 / cartoon 2344 / sketch 3929),
  80/10/10 split (train 7993), min 64 train/cell.
- **PACS Analyzer (2026-07-13):** 42-triplet overview heat-colored by mean CLIP cosine (train pairs;
  least alike: person photo×art .248, most alike: elephant cartoon×sketch .628) → drill into x∈[1,20]
  cross-domain pairs (default 10). Random mode (seeded, Reshuffle) + ERM mode with criterion dropdown:
  confident exemplars (default) / ERM divergence / ERM agreement. Per-triplet judgments (1–5 + note,
  provenance-stamped) with badges + JSON/CSV export. LIVE-VERIFIED: same seed reproduces the identical
  cluster; all three criteria rank distinctly; pre-merge saved game seed-verifies 10/10 match.
- **ML pipeline RUN (2026-07-13):** 02 (CLIP, ran on Intel XPU ~2.5 min) + 03 (probes, train-only fit)
  + `build_triplet_stats.py` + `merge_probs_into_manifest.py`. Embeddings kept at
  `pipeline/data/embeddings/` (512-d, L2-normed) for future use.

## Pending / next
1. **Shared hosting** (S3 + CloudFront) for multi-annotator use — needs CORS for screenshots. Deferred.
2. **Persistence / backend** and scale toward the 1,000-pair goal. Deferred.
3. Ideas: per-pair CLIP-cosine badges in Analyzer clusters (needs client-side embeddings, ~10 MB
   quantized); LODO split variant if the PI wants it (see splits.py note).

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
