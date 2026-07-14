"""Merge precomputed CLIP/ERM/mixture probs into the LIVE web manifest.

build_real_manifest.py wrote web/public/manifest.json with empty clipProbs /
ermProbs and mix=null (Modes 2/3 paused). This script injects the vectors
produced by steps 02+03 into that manifest IN PLACE, preserving everything
else — version, cdnBase, split, file paths, and (critically) IMAGE ORDER.

HASH SAFETY: the web app's manifestHash (web/src/lib/manifest.ts) fingerprints
only `version` + the ordered image ids, so this merge does NOT invalidate
saved games — replay/resume/seed-verify keep working on the merged manifest.

A backup is written to manifest.json.bak first. Probabilities are rounded to
4 decimals to keep the manifest small.

Run (after 02 + 03):
    python merge_probs_into_manifest.py
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import config

MANIFEST_PATH = config.PIPELINE_DIR.parent / "web" / "public" / "manifest.json"


def _load(path: Path):
    if not path.exists():
        raise SystemExit(f"Missing required artifact: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _vec(raw, label: str, iid: str) -> list[float]:
    if not isinstance(raw, list) or len(raw) != len(config.CLASSES):
        raise SystemExit(f"{label} for {iid} is not length-{len(config.CLASSES)}")
    return [round(float(x), 4) for x in raw]


def main() -> None:
    manifest = _load(MANIFEST_PATH)
    clip_probs = _load(config.PROBS_DIR / "clip_probs.json")
    erm_probs = _load(config.PROBS_DIR / "erm_probs.json")
    mix_probs = _load(config.PROBS_DIR / "mix_probs.json")

    images = manifest["images"]
    missing = [im["id"] for im in images if im["id"] not in clip_probs or im["id"] not in erm_probs]
    if missing:
        raise SystemExit(
            f"{len(missing)} manifest ids missing from probs (e.g. {missing[:3]}). "
            "Re-run 02/03 so every image is covered."
        )

    n_mix = 0
    for im in images:
        iid = im["id"]
        im["clipProbs"] = _vec(clip_probs[iid], "clipProbs", iid)
        im["ermProbs"] = _vec(erm_probs[iid], "ermProbs", iid)
        if im["domain"] in config.MIX_DOMAINS:
            raw_mix = mix_probs.get(iid)
            if raw_mix is None:
                raise SystemExit(f"mix probs missing for photo/cartoon image {iid}")
            im["mix"] = {
                key: _vec(raw_mix[key], f"mix.{key}", iid)
                for key in config.MIX_RATIOS  # balanced, photoHeavy, cartoonHeavy
            }
            n_mix += 1
        # non-mix domains keep mix as-is (null)

    backup = MANIFEST_PATH.with_suffix(".json.bak")
    shutil.copy2(MANIFEST_PATH, backup)
    MANIFEST_PATH.write_text(
        json.dumps(manifest, separators=(",", ":")), encoding="utf-8"
    )

    print(f"Merged probs into {MANIFEST_PATH}")
    print(f"  images: {len(images)} · with mix: {n_mix} · backup: {backup.name}")
    print("  version/cdnBase/split/order untouched — manifest hash is unchanged.")


if __name__ == "__main__":
    main()
