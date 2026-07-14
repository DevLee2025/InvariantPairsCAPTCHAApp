"""Build per-triplet CLIP-cosine statistics for the PACS Analyzer overview.

A "triplet" is (class, domainA, domainB): one of the 7 classes crossed with one
of the 6 unordered domain pairs — 42 total. For each triplet we take every
cross-domain same-class TRAIN pair (the Analyzer inspects the same pool the
game collects from) and summarize the CLIP cosine similarity of all A×B
combinations. The embeddings from step 02 are L2-normalized, so cosine
similarity is a single matmul per triplet.

Output: web/public/triplet_stats.json (tiny — 42 rows). The Analyzer overview
uses meanCos to heat-color the 7×6 grid; the file is regenerable and gitignored
(same policy as manifest.json).

Run (after 02):
    python build_triplet_stats.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path

import config
import splits

OUT_PATH = config.PIPELINE_DIR.parent / "web" / "public" / "triplet_stats.json"


def main() -> None:
    import numpy as np  # type: ignore

    ids_path = config.EMB_DIR / "ids.json"
    emb_path = config.EMB_DIR / "embeddings.npy"
    if not ids_path.exists() or not emb_path.exists():
        raise SystemExit("Missing embeddings/ids. Run 02_compute_clip.py first.")
    ids: list[str] = json.loads(ids_path.read_text(encoding="utf-8"))
    emb = np.load(emb_path)

    # Same seeded stratified split as the manifest (assign_splits sorts
    # internally, so id order doesn't matter).
    split_map = splits.assign_splits(ids, config.SPLIT_RATIOS, config.SPLIT_SEED)

    # Train-row indices per (domain, class) cell.
    cell_rows: dict[tuple[str, str], list[int]] = {}
    for r, iid in enumerate(ids):
        if split_map[iid] != "train":
            continue
        domain, cls, _ = iid.split("/", 2)
        cell_rows.setdefault((domain, cls), []).append(r)

    triplets: list[dict] = []
    for cls in config.CLASSES:
        for dom_a, dom_b in combinations(config.DOMAINS, 2):
            rows_a = cell_rows.get((dom_a, cls), [])
            rows_b = cell_rows.get((dom_b, cls), [])
            if not rows_a or not rows_b:
                raise SystemExit(f"Empty train cell for {cls} × {dom_a}/{dom_b}.")
            sims = emb[rows_a] @ emb[rows_b].T  # [nA, nB] cosine (unit-norm)
            flat = sims.ravel()
            triplets.append(
                {
                    "class": cls,
                    "domainA": dom_a,
                    "domainB": dom_b,
                    "nA": len(rows_a),
                    "nB": len(rows_b),
                    "meanCos": round(float(flat.mean()), 4),
                    "medianCos": round(float(np.median(flat)), 4),
                    "p10": round(float(np.percentile(flat, 10)), 4),
                    "p90": round(float(np.percentile(flat, 90)), 4),
                }
            )

    out = {
        "version": 1,
        "split": "train",
        "clipModel": f"{config.CLIP_MODEL_NAME}/{config.CLIP_PRETRAINED}",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "triplets": triplets,
    }
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    ranked = sorted(triplets, key=lambda t: t["meanCos"])
    print(f"Wrote {len(triplets)} triplet stats -> {OUT_PATH}")
    lo, hi = ranked[0], ranked[-1]
    print(f"  least alike: {lo['class']} {lo['domainA']}×{lo['domainB']} meanCos {lo['meanCos']}")
    print(f"  most alike : {hi['class']} {hi['domainA']}×{hi['domainB']} meanCos {hi['meanCos']}")


if __name__ == "__main__":
    main()
