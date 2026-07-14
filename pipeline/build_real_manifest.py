"""Build the REAL PACS dataset for the game (Mode 1 focus).

Downloads PACS from HuggingFace (flwrlabs/pacs), writes the actual JPEGs into the
web app's public dir so they are served same-origin (no CDN needed yet, and
html2canvas screenshots stay capture-able), assigns the stratified train/val/test
split, and emits a real metadata manifest.

CLIP/ERM/mixture fields are left empty (clipProbs=[], ermProbs=[], mix=null)
because Modes 2 & 3 are paused — Mode 1 (cross-domain) needs only metadata. The
front-end auto-detects this (those modes report "unavailable").

Output:
  web/public/pacs/<domain>/<class>/<stem>.jpg
  web/public/manifest.json   (cdnBase "/pacs")

Run:  python build_real_manifest.py
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import config
import splits

PIPELINE_DIR = Path(__file__).resolve().parent
WEB_PUBLIC = PIPELINE_DIR.parent / "web" / "public"
PACS_DIR = WEB_PUBLIC / "pacs"
MANIFEST_OUT = WEB_PUBLIC / "manifest.json"
CDN_BASE = "/pacs"  # same-origin local serving


def main() -> None:
    from datasets import load_dataset  # heavy import, kept local

    print("Loading flwrlabs/pacs (downloads ~190 MB on first run)…")
    ds = load_dataset("flwrlabs/pacs", split="train")
    label_names = ds.features["label"].names  # ['dog', ...]
    print(f"  {len(ds)} images · classes {label_names}")

    counters: dict[tuple[str, str], int] = defaultdict(int)
    records: list[dict] = []
    per_domain: dict[str, int] = defaultdict(int)

    for i, ex in enumerate(ds):
        domain = ex["domain"]
        cls = label_names[ex["label"]]
        n = counters[(domain, cls)]
        counters[(domain, cls)] += 1
        stem = f"{n:04d}"
        rel = f"{domain}/{cls}/{stem}.jpg"

        out_path = PACS_DIR / domain / cls / f"{stem}.jpg"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img = ex["image"]
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(out_path, format="JPEG", quality=90)

        records.append(
            {
                "id": f"{domain}/{cls}/{stem}",
                "domain": domain,
                "class": cls,
                "file": rel,
                "clipProbs": [],  # Modes 2/3 paused — populated by the ML pipeline later
                "ermProbs": [],
                "mix": None,
            }
        )
        per_domain[domain] += 1
        if (i + 1) % 1000 == 0:
            print(f"  saved {i + 1} images…")

    # Stratified, seeded train/val/test split (game draws train only).
    split_map = splits.assign_splits(
        [r["id"] for r in records], config.SPLIT_RATIOS, config.SPLIT_SEED
    )
    for r in records:
        r["split"] = split_map[r["id"]]

    manifest = {
        "version": 1,
        "domains": config.DOMAINS,
        "classes": config.CLASSES,
        "cdnBase": CDN_BASE,
        "images": records,
    }
    MANIFEST_OUT.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")

    from collections import Counter

    by_split = Counter(r["split"] for r in records)
    print("\nDone.")
    print(f"  images written : {len(records)} -> {PACS_DIR}")
    print(f"  per domain     : {dict(per_domain)}")
    print(f"  by split       : {dict(by_split)}  (game draws train only)")
    print(f"  manifest       : {MANIFEST_OUT}")
    # sanity: smallest train cell vs max grid (8x8=64)
    train_cells: dict[tuple[str, str], int] = defaultdict(int)
    for r in records:
        if r["split"] == "train":
            train_cells[(r["domain"], r["class"])] += 1
    mn = min(train_cells.values())
    print(f"  min train/cell : {mn}  ({'OK for 8x8=64' if mn >= 64 else 'NOTE: < 64, large grids will mix domains'})")


if __name__ == "__main__":
    main()
