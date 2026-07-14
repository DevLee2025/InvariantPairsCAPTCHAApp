"""Step 04 — Assemble the static manifest.json from precomputed artifacts.

Reads:
  - EMB_DIR/ids.json           (row-aligned image ids, the master image list)
  - PROBS_DIR/clip_probs.json  (zero-shot CLIP probs)        from step 02
  - PROBS_DIR/erm_probs.json   (ERM probe probs)             from step 03
  - PROBS_DIR/mix_probs.json   (photo+cartoon mixture probs) from step 03

Writes:
  - OUT_DIR/manifest.json conforming exactly to SPEC §4.

`mix` is populated only for photo & cartoon images (Mode 3 is photo<->cartoon
only); it is null for art_painting & sketch.

This step is stdlib-only and safe to run after 02/03 complete. It deliberately
does NOT write into web/public/ (that's outside pipeline/); instead it prints a
one-line copy instruction.

Run:
    python 04_build_manifest.py
"""

from __future__ import annotations

import json
from pathlib import Path

import config
import splits

MANIFEST_VERSION = 1


def _load_json(path: Path):
    if not path.exists():
        raise SystemExit(f"Missing required artifact: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _id_parts(iid: str) -> tuple[str, str, str]:
    """Split "<domain>/<class>/<stem>" -> (domain, class, stem)."""
    domain, cls, stem = iid.split("/", 2)
    return domain, cls, stem


def _validate_vec(vec, label: str, iid: str) -> list[float]:
    """Assert a probability vector is length-7; return it as floats."""
    if not isinstance(vec, (list, tuple)) or len(vec) != len(config.CLASSES):
        raise SystemExit(
            f"{label} for {iid} is not length-{len(config.CLASSES)}: {vec!r}"
        )
    return [float(x) for x in vec]


def build_manifest() -> dict:
    ids = _load_json(config.EMB_DIR / "ids.json")
    clip_probs = _load_json(config.PROBS_DIR / "clip_probs.json")
    erm_probs = _load_json(config.PROBS_DIR / "erm_probs.json")
    mix_probs = _load_json(config.PROBS_DIR / "mix_probs.json")

    # Stratified, seeded train/val/test split (SPEC §3, §5.1). The game draws
    # ONLY from "train"; val/test are held out of pair collection.
    split_map = splits.assign_splits(ids, config.SPLIT_RATIOS, config.SPLIT_SEED)

    images = []
    for iid in ids:
        domain, cls, stem = _id_parts(iid)

        if iid not in clip_probs:
            raise SystemExit(f"clipProbs missing for {iid}")
        if iid not in erm_probs:
            raise SystemExit(f"ermProbs missing for {iid}")

        # mix only for photo + cartoon, else null
        if domain in config.MIX_DOMAINS:
            raw_mix = mix_probs.get(iid)
            if raw_mix is None:
                raise SystemExit(f"mix probs missing for photo/cartoon image {iid}")
            mix = {
                key: _validate_vec(raw_mix[key], f"mix.{key}", iid)
                for key in config.MIX_RATIOS  # balanced, photoHeavy, cartoonHeavy
            }
        else:
            mix = None

        images.append(
            {
                "id": iid,
                "domain": domain,
                "class": cls,
                "split": split_map[iid],
                "file": f"{domain}/{cls}/{stem}.jpg",
                "clipProbs": _validate_vec(clip_probs[iid], "clipProbs", iid),
                "ermProbs": _validate_vec(erm_probs[iid], "ermProbs", iid),
                "mix": mix,
            }
        )

    return {
        "version": MANIFEST_VERSION,
        "domains": config.DOMAINS,
        "classes": config.CLASSES,
        "cdnBase": config.CDN_BASE,
        "images": images,
    }


def main() -> None:
    config.ensure_dirs()
    manifest = build_manifest()

    out_path = config.OUT_DIR / "manifest.json"
    out_path.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")

    n = len(manifest["images"])
    n_mix = sum(1 for im in manifest["images"] if im["mix"] is not None)
    print(f"Wrote {out_path} with {n} images ({n_mix} with mix).")
    if "REPLACE" in config.CDN_BASE:
        print("WARNING: cdnBase still contains a REPLACE placeholder — set "
              "config.CDN_BASE before going to production.")
    # We must not write outside pipeline/. Tell the operator how to deploy it.
    print("\nNext step — point the web app at this manifest. Copy it into the "
          "web app's public dir, e.g.:")
    print(f'    cp "{out_path}" ../web/public/manifest.json')


if __name__ == "__main__":
    main()
