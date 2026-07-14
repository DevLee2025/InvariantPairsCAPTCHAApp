"""Generate a SYNTHETIC manifest with the exact production schema.

Purpose: let the web app run end-to-end before real PACS data / CLIP outputs /
CDN exist. The numbers are plausible random probabilities (the true class is
biased higher), and image URLs are picsum.photos seeds so every tile renders.

Schema (SPEC §4), per image:
  { id, domain, class, file, clipProbs[7], ermProbs[7],
    mix:{balanced[7],photoHeavy[7],cartoonHeavy[7]} | null }
`mix` is populated ONLY for photo & cartoon images.

Guarantees:
  - >= 12 images per (domain, class) cell, so every anchor has >= 9 candidates.
  - all probability vectors sum to 1 and are length-7.

DEPENDENCY-LIGHT: standard library only. numpy is used if present but a pure
stdlib fallback keeps this runnable anywhere. No torch/sklearn/datasets.

Output: OUT_DIR/manifest.synthetic.json

Run:
    python make_synthetic_manifest.py
"""

from __future__ import annotations

import json
import random
from collections import Counter

import config
import splits

# How many synthetic images to emit per (domain, class) cell. With an 80% train
# split that leaves ~13 train per cell, so the universal candidate pool (same
# class, partner domain, TRAIN only) always has >=9 members with room for
# freshness exclusions.
PER_CELL = 16

# For picsum, we use the image id as a stable seed so a given tile is consistent
# across reloads: https://picsum.photos/seed/<seed>/256
PICSUM_TEMPLATE = "https://picsum.photos/seed/{seed}/256"

# Deterministic output across runs.
SEED = 1234


def _normalize(vec: list[float]) -> list[float]:
    """Scale a non-negative vector to sum to 1.0 (stdlib, no numpy)."""
    total = sum(vec)
    if total <= 0:
        # Degenerate guard: fall back to uniform.
        n = len(vec)
        return [1.0 / n for _ in vec]
    return [v / total for v in vec]


def _random_prob_vector(true_idx: int, rng: random.Random) -> list[float]:
    """A length-7 probability vector biased toward `true_idx`.

    Every class gets a small random base mass; the true class gets a large
    extra boost so argmax is *usually* (not always) the true class — mimicking
    a decent-but-imperfect classifier.
    """
    n = len(config.CLASSES)
    # Small positive base noise for all classes.
    vec = [rng.uniform(0.01, 0.20) for _ in range(n)]
    # Strong boost for the true class.
    vec[true_idx] += rng.uniform(1.5, 4.0)
    return _normalize(vec)


def _seed_for(image_id: str) -> str:
    """Picsum-safe seed: replace slashes so it stays a single path segment."""
    return image_id.replace("/", "_")


def build_synthetic() -> dict:
    rng = random.Random(SEED)
    class_to_idx = {c: i for i, c in enumerate(config.CLASSES)}

    images = []
    for domain in config.DOMAINS:
        for cls in config.CLASSES:
            true_idx = class_to_idx[cls]
            for k in range(PER_CELL):
                stem = f"{k:04d}"
                image_id = f"{domain}/{cls}/{stem}"

                clip_probs = _random_prob_vector(true_idx, rng)
                erm_probs = _random_prob_vector(true_idx, rng)

                # mix only for photo + cartoon (Mode 3 is photo<->cartoon only)
                if domain in config.MIX_DOMAINS:
                    mix = {
                        ratio: _random_prob_vector(true_idx, rng)
                        for ratio in config.MIX_RATIOS  # balanced/photoHeavy/cartoonHeavy
                    }
                else:
                    mix = None

                images.append(
                    {
                        "id": image_id,
                        "domain": domain,
                        "class": cls,
                        "file": f"{domain}/{cls}/{stem}.jpg",
                        "clipProbs": clip_probs,
                        "ermProbs": erm_probs,
                        "mix": mix,
                    }
                )

    # Assign the train/val/test split (stratified per domain×class, seeded) and
    # tag every image. The web app draws ONLY from "train".
    split_map = splits.assign_splits(
        [im["id"] for im in images], config.SPLIT_RATIOS, config.SPLIT_SEED
    )
    for im in images:
        im["split"] = split_map[im["id"]]

    return {
        "version": 1,
        "domains": config.DOMAINS,
        "classes": config.CLASSES,
        # Synthetic CDN base: front-end builds image URLs from picsum seeds. We
        # also expose cdnBase for schema-completeness; the web app's synthetic
        # loader prefers per-image picsum URLs derived from the id.
        "cdnBase": "https://picsum.photos/seed",
        "images": images,
    }


def main() -> None:
    config.ensure_dirs()
    manifest = build_synthetic()

    out_path = config.OUT_DIR / "manifest.synthetic.json"
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    n = len(manifest["images"])
    n_mix = sum(1 for im in manifest["images"] if im["mix"] is not None)
    n_cells = len(config.DOMAINS) * len(config.CLASSES)
    by_split = Counter(im["split"] for im in manifest["images"])
    print(f"Wrote {out_path}")
    print(f"  images          : {n}  ({n_cells} cells x {PER_CELL} per cell)")
    print(f"  with mix        : {n_mix}  (photo+cartoon only)")
    print(f"  by split        : {dict(by_split)}  (game draws train only)")
    print(f"  picsum url eg.  : "
          f"{PICSUM_TEMPLATE.format(seed=_seed_for(manifest['images'][0]['id']))}")


if __name__ == "__main__":
    main()
