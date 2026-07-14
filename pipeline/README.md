# GRIT Pipeline — Phase 0 (offline data/ML)

This directory builds the static **`manifest.json`** that the web game consumes
and uploads the PACS JPEGs to a CDN. The browser never runs CLIP or trains
probes — everything model-related is precomputed here (SPEC §2, §10).

The whole job: **PACS → CLIP embeddings + zero-shot probs → linear probes →
`manifest.json`**, plus image upload to S3 + CloudFront.

---

## Prerequisites

- **Python 3.11+** (developed/tested with 3.13).
- For the real ML steps: a few GB of disk and patience. **GPU is optional** —
  CLIP runs on CPU, just slowly (~10k small images).
- For the upload step: AWS credentials on the standard boto3 chain
  (`aws configure`, env vars, or an instance role) and a real S3 bucket.

## Install

```bash
cd pipeline
python -m venv .venv
# Windows:  .venv\Scripts\activate
# POSIX:    source .venv/bin/activate
pip install -r requirements.txt
```

The synthetic-manifest generator needs **none** of these — see the last section.

---

## Configure

Edit `config.py`:

- `CDN_BASE`, `S3_BUCKET`, `CLOUDFRONT_DIST` — replace the `REPLACE…`
  placeholders before a real upload / production manifest.
- `CLIP_MODEL_NAME` / `CLIP_PRETRAINED` — defaults to a small `ViT-B-32` that
  runs on CPU. Swap for a larger backbone if you have a GPU.

`DOMAINS`, `CLASSES`, and `MIX_RATIOS` are the canonical label spaces — the
order is load-bearing (every probability vector is indexed by it). Do not
reorder them.

---

## Run order (01 → 05)

Filenames start with digits, so run them **by path**, not as `-m` modules:

```bash
python 01_download_pacs.py      # PACS -> data/raw/<domain>/<class>/<stem>.jpg
python 02_compute_clip.py       # frozen CLIP -> embeddings.npy + clip_probs.json
python 03_train_probes.py       # ERM probe + 3 mixture probes -> erm/mix probs
python 04_build_manifest.py     # assemble -> out/manifest.json
python 05_upload_cdn.py         # upload data/raw/**.jpg -> S3 (needs AWS creds)
```

What each step produces:

| Step | Output |
|------|--------|
| 01 | `data/raw/<domain>/<class>/<stem>.jpg` |
| 02 | `data/embeddings/embeddings.npy`, `ids.json`; `data/probs/clip_probs.json` |
| 03 | `data/probs/erm_probs.json`, `data/probs/mix_probs.json` |
| 04 | `out/manifest.json` (the production contract, SPEC §4) |
| 05 | objects in `s3://<bucket>/pacs/<domain>/<class>/<stem>.jpg` |

`mix` is populated only for **photo** and **cartoon** images (Mode 3 is
photo↔cartoon only); it is `null` for art_painting and sketch.

---

## Point the web app at the manifest

Step 04 deliberately does **not** write outside `pipeline/`. It prints a copy
instruction; run it yourself:

```bash
cp out/manifest.json ../web/public/manifest.json
```

Set `CDN_BASE` to your real CloudFront URL **before** running step 04 so the
manifest's `cdnBase` is correct (image URL = `${cdnBase}/${file}`).

---

## Synthetic manifest (front-end dev, no data needed)

To unblock web development before any real data/CDN exists:

```bash
python make_synthetic_manifest.py     # -> out/manifest.synthetic.json
```

- **Stdlib only** — no torch/sklearn/datasets required.
- Exact production schema, ≥12 images per (domain,class) cell (so every anchor
  always has ≥9 candidates), realistic random probabilities, `mix` populated
  for photo+cartoon only.
- Image URLs are `https://picsum.photos/seed/<id>/256`, so every tile renders.

Copy it into the web app the same way:

```bash
cp out/manifest.synthetic.json ../web/public/manifest.json
```
