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
  SPEC.md        ← authoritative spec
  README.md      ← this file
  web/           ← React + Vite + TypeScript front-end (the game)
  pipeline/      ← Python Phase-0 pipeline (PACS → CLIP/ERM/mixture probes → manifest → CDN)
```

The front-end depends only on a static `manifest.json` + image CDN URLs — never on Python at
runtime. The pipeline produces that manifest offline.

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

- Top-level **Play / Review** views. Play: pick the option most similar to the anchor → saves an
  invariant pair; grid 2×2–8×8; seeded + replayable; per-pick screenshots; JSON/CSV + screenshots PDF.
  Review: load a saved game JSON, inspect picks (numbered, red-bordered), add reviewer comments,
  verify the seed, export an annotation PDF / annotated JSON.
- `npm run build` — typecheck (`tsc --noEmit`) + production build.
- `dev` preset = 250 pairs/mode; `production` = 334/333/333 = 1,000.

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

## Full ML pipeline (for Modes 2 & 3, when un-paused)

See [`pipeline/README.md`](pipeline/README.md): `01_download_pacs` → `02_compute_clip` →
`03_train_probes` → `04_build_manifest` (adds CLIP/ERM/mixture probs) → optional `05_upload_cdn`
for S3+CloudFront hosting at scale.

## Status

- [x] Spec
- [x] Front-end: Play + Review, seeded/replayable, grid sizes, timing, notes, screenshots PDF, annotation PDF (verified live)
- [x] **Real PACS data** built & served locally — Mode 1 is a real invariant-pair builder
- [ ] Un-pause Modes 2 & 3: run CLIP/ERM/mixture pipeline → real probs in the manifest
- [ ] Stand up S3+CloudFront for shared/scaled hosting
- [ ] Persistence + HuggingFace (human-viewable) / spreadsheet export
