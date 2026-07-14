"""Central configuration for the GRIT invariant-pairs Phase-0 pipeline.

Single source of truth for the four PACS domains, seven classes, mixture
ratios, on-disk paths, CDN/S3 placeholders and the CLIP model name. Every
other script imports from here so the manifest contract stays consistent.

This module is intentionally dependency-light (stdlib only) so that importing
it never triggers a heavy ML import.
"""

from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# Canonical label spaces (order is LOAD-BEARING — every probability vector in
# the manifest is indexed by these orders; do not reorder casually).
# ---------------------------------------------------------------------------

# PACS domains, in manifest order.
DOMAINS: list[str] = ["photo", "art_painting", "cartoon", "sketch"]

# PACS classes, in manifest order. clipProbs/ermProbs/mix.* are all length-7
# vectors indexed by this list.
CLASSES: list[str] = [
    "dog",
    "elephant",
    "giraffe",
    "guitar",
    "horse",
    "house",
    "person",
]

# Mode 3 mixture probes operate on the photo+cartoon subset only. Each ratio is
# (photo_fraction, cartoon_fraction) used when resampling the training subset.
# Keys match the manifest's `mix` object exactly.
MIX_RATIOS: dict[str, tuple[float, float]] = {
    "balanced": (0.5, 0.5),      # 50:50 photo:cartoon
    "photoHeavy": (0.9, 0.1),    # 90:10 photo:cartoon
    "cartoonHeavy": (0.1, 0.9),  # 10:90 photo:cartoon
}

# Domains that get a populated `mix` block (Mode 3 is photo<->cartoon only).
MIX_DOMAINS: list[str] = ["photo", "cartoon"]

# Train/val/test split. The game draws ONLY from "train"; val/test are held out
# so they never appear in collected invariant pairs (SPEC §3, §5.1). Stratified
# per (domain, class) and seeded — see splits.py.
SPLIT_RATIOS: dict[str, float] = {"train": 0.8, "val": 0.1, "test": 0.1}
SPLIT_SEED: int = 20260623

# ---------------------------------------------------------------------------
# Filesystem layout. Everything lives under the pipeline/ directory so the
# pipeline never writes outside its own tree.
# ---------------------------------------------------------------------------

# Directory containing this config.py (the pipeline/ root).
PIPELINE_DIR: Path = Path(__file__).resolve().parent

# Raw PACS JPEGs land here as RAW_DIR/<domain>/<class>/<stem>.jpg
RAW_DIR: Path = PIPELINE_DIR / "data" / "raw"

# Intermediate artifacts (CLIP embeddings, per-image prob vectors).
EMB_DIR: Path = PIPELINE_DIR / "data" / "embeddings"
PROBS_DIR: Path = PIPELINE_DIR / "data" / "probs"

# Final + synthetic manifests are written here.
OUT_DIR: Path = PIPELINE_DIR / "out"

# ---------------------------------------------------------------------------
# CLIP configuration.
# ---------------------------------------------------------------------------

# open_clip model name + pretrained tag. ViT-B/32 is a small, fast default that
# runs on CPU (slowly). Swap for a larger backbone if a GPU is available.
CLIP_MODEL_NAME: str = "ViT-B-32"
CLIP_PRETRAINED: str = "laion2b_s34b_b79k"

# Zero-shot prompt template. {cls} is filled with each class name.
CLIP_PROMPT_TEMPLATE: str = "a photo of a {cls}"

# Embedding dimensionality for ViT-B/32 (used only for sanity checks / docs).
CLIP_EMB_DIM: int = 512

# ---------------------------------------------------------------------------
# CDN / AWS placeholders. Replace the REPLACE.* tokens before a real upload.
# cdnBase is what the web app stores in the manifest and prepends to each
# image's `file` field: url = `${cdnBase}/${file}`.
# ---------------------------------------------------------------------------

# Public CloudFront base, including the /pacs key prefix used on upload.
CDN_BASE: str = "https://REPLACE.cloudfront.net/pacs"

# Target S3 bucket for the raw JPEGs.
S3_BUCKET: str = "REPLACE-pacs-bucket"

# Key prefix under which images are stored in S3 (kept in sync with CDN_BASE).
S3_PREFIX: str = "pacs"

# CloudFront distribution id (for cache invalidations / docs).
CLOUDFRONT_DIST: str = "REPLACE_DISTRIBUTION_ID"

# HuggingFace dataset id for PACS.
HF_DATASET: str = "flwrlabs/pacs"


def ensure_dirs() -> None:
    """Create all output/intermediate directories if they do not exist.

    Safe to call repeatedly. Scripts call this before writing artifacts.
    """
    for d in (RAW_DIR, EMB_DIR, PROBS_DIR, OUT_DIR):
        d.mkdir(parents=True, exist_ok=True)


if __name__ == "__main__":
    # Tiny self-report so `python config.py` is a useful sanity check.
    print(f"pipeline dir : {PIPELINE_DIR}")
    print(f"domains      : {DOMAINS}")
    print(f"classes      : {CLASSES}")
    print(f"mix ratios   : {MIX_RATIOS}")
    print(f"raw dir      : {RAW_DIR}")
    print(f"out dir      : {OUT_DIR}")
    print(f"clip model   : {CLIP_MODEL_NAME} / {CLIP_PRETRAINED}")
    print(f"cdn base     : {CDN_BASE}")
