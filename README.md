# GRIT Invariant-Pairs Game

A web game that crowd-sources **invariant image pairs** from the PACS dataset to feed the
**GRIT** method (Geometric Robustness via Invariant Training). An annotator picks, from nine
candidates, the one most similar to an anchor; each chosen `(anchor, selected)` pair — same
object class, different visual domain — is a noisy invariant pair whose CLIP-space difference
vector helps estimate the spurious subspace GRIT projects out.

**Read [`SPEC.md`](SPEC.md) first** — it is the authoritative design doc (architecture,
manifest schema, selection modes, session/quota model, data schemas, UI, roadmap).

## Repo layout

```
OTG/
  SPEC.md        ← original spec (see MIGRATION.md for what supersedes it)
  MIGRATION.md   ← current-state snapshot (data contracts, status, gotchas)
  README.md      ← this file
  web/           ← React + Vite + TypeScript front-end (Play / Review / Analyzer)
  pipeline/      ← Python pipeline (PACS → CLIP/ERM/mixture probes → manifest; HF export)
  server/        ← FastAPI multi-annotator Review API (share codes; optional)
```

The front-end depends only on a static `manifest.json` + local images at runtime; the optional
annotation server enables the shared multi-annotator Review mode.

## Build the real PACS data (once)

```bash
cd pipeline
pip install datasets pillow
python build_real_manifest.py    # downloads PACS (~190 MB), writes web/public/pacs/** + web/public/manifest.json
```

This downloads PACS from HuggingFace (`flwrlabs/pacs`, 9,991 images), writes the real JPEGs into
`web/public/pacs/<domain>/<class>/<stem>.jpg` (served **same-origin**, no CDN needed yet — which
also keeps html2canvas screenshots working), assigns the stratified 80/10/10 train/val/test split,
and emits `web/public/manifest.json` (`cdnBase: "/pacs"`). CLIP/ERM/mixture fields are left empty
because Modes 2 & 3 are paused — Mode 1 needs only metadata, and the front-end auto-disables the
ML modes when their data is absent.

> `web/public/pacs/` + `web/public/manifest.json` are local data (gitignored, ~190 MB). Don't `npm run build` with them present unless you want them copied into `dist/`.

## Run the game (front-end)

```bash
cd web
npm install
npm run dev      # http://localhost:5173
```

The front-end loads `/manifest.json` (real PACS) if present, else falls back to the committed
synthetic dev manifest (`web/public/manifest.sample.json`, placeholder SVG tiles) so it always runs.

- Top-level **Play / Review / Analyzer** views. Play: toggle-select every option similar to the
  anchor, "Save N pairs" (multi-select, schema v3); grid 2×2–8×8; seeded + replayable; per-submit
  screenshots; JSON/CSV + screenshots PDF. Review: load a saved game JSON (v2 or v3), inspect picks,
  add reviewer comments, verify the seed, export annotation PDF / annotated JSON. Analyzer: judge
  the 42 class×domain-pair triplets (CLIP heatmap, Random/ERM clusters, exportable judgments).
- `npm run build` — typecheck (`tsc --noEmit`) + production build.
- `dev` preset = 250 pairs/mode; `production` = 334/333/333 = 1,000.

## Multi-annotator Review (shared blind annotation)

Several annotators can review the same game independently. Start the annotation server next to
the dev server:

```bash
pip install -r server/requirements.txt   # once
cd web && npm run api                    # FastAPI on 127.0.0.1:8787 (or: python server/app.py)
```

In **Review**, load a game JSON and click **"Share for annotators…"** → you get a 6-character
code. Other annotators pick **"Join with a code"** and enter it plus a username. Each annotator
is **blind** per puzzle — the player's selections/note and other annotators' comments stay hidden
until they click "Show responses" (reveals are permanent and timestamped, so blind comments are
distinguishable). Comments save server-side per annotator (`server/data/<CODE>/annotations/`),
so nobody's work can clobber anyone else's. Exports merge every annotator, attributed.

For annotators on the lab LAN: run `npm run dev -- --host` and share `http://<your-ip>:5173` —
the app proxies `/api` to the local server, so that one URL is all they need.

## Export a HuggingFace dataset

The game's JSON export is the **review/replay** artifact (one game object) — don't upload it
straight to HuggingFace (it ingests as a single row and errors on the empty `scores` struct).
Instead build a proper per-pair dataset with embedded, viewable images:

```bash
cd pipeline
python build_hf_dataset.py <game.json | folder-of-games> [--include-options]
# → out/hf/invariant_pairs.parquet   (upload directly to a HF dataset repo — images render)
# → out/hf/dataset                   (load_from_disk(...).push_to_hub('user/name'))
```

One row per pair, flat columns (no empty structs), `anchor_image` + `selected_image` embedded
(`--include-options` also embeds all option images). Reads images from `web/public/pacs/`.