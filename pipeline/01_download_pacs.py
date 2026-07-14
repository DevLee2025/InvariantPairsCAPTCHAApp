"""Step 01 — Download PACS from HuggingFace to local disk.

Pulls `flwrlabs/pacs` via the `datasets` library and writes every image to

    RAW_DIR/<domain>/<class>/<stem>.jpg

The dataset stores labels as integers; we map them to class names. The domain
column is similarly mapped to a domain name. Filenames in PACS are NOT uniform,
so we derive a *stable* stem per image (preferring any original filename the
dataset carries, otherwise a zero-padded running index per (domain,class) cell).

Heavy deps (`datasets`, `PIL`) are imported inside main() so this file is
import-safe and `python -m py_compile` passes without them installed.

Run:
    python 01_download_pacs.py
"""

from __future__ import annotations

import re
from pathlib import Path

import config


def _slugify_stem(value: str) -> str:
    """Turn an arbitrary filename/string into a filesystem-safe stem.

    Strips any directory part and extension, lowercases nothing (PACS stems may
    be meaningful), and replaces unsafe characters with underscores.
    """
    stem = Path(str(value)).stem
    return re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("_") or "img"


def _resolve_label_names(features) -> tuple[list[str] | None, list[str] | None]:
    """Best-effort extraction of (domain_names, class_names) from HF features.

    `datasets.ClassLabel` features expose `.names`. PACS column naming varies
    across mirrors, so we probe a few likely column names and fall back to our
    canonical config lists when the feature is a plain integer.

    Returns (domain_names_or_None, class_names_or_None). None means "use the
    integer index directly against config.DOMAINS / config.CLASSES".
    """
    domain_names = None
    class_names = None

    for col in ("domain", "domains", "style"):
        feat = features.get(col) if hasattr(features, "get") else None
        if feat is not None and getattr(feat, "names", None):
            domain_names = list(feat.names)
            break

    for col in ("label", "labels", "class"):
        feat = features.get(col) if hasattr(features, "get") else None
        if feat is not None and getattr(feat, "names", None):
            class_names = list(feat.names)
            break

    return domain_names, class_names


def _pick_column(example: dict, candidates: tuple[str, ...]):
    """Return the first present column value from `candidates`, else None."""
    for c in candidates:
        if c in example:
            return example[c]
    return None


def main() -> None:
    # Heavy imports kept local so the module stays import-safe.
    from datasets import load_dataset  # type: ignore
    from tqdm import tqdm  # type: ignore

    config.ensure_dirs()

    print(f"Loading dataset {config.HF_DATASET} (train split) ...")
    ds = load_dataset(config.HF_DATASET, split="train")

    domain_names, class_names = _resolve_label_names(ds.features)
    if domain_names is None:
        print("  domain feature has no .names — assuming integer index aligns "
              "with config.DOMAINS order.")
        domain_names = config.DOMAINS
    if class_names is None:
        print("  label feature has no .names — assuming integer index aligns "
              "with config.CLASSES order.")
        class_names = config.CLASSES

    # Per-(domain,class) running counter to synthesize stable stems when the
    # dataset does not carry an original filename.
    counters: dict[tuple[str, str], int] = {}
    written = 0

    for example in tqdm(ds, desc="writing PACS jpegs"):
        # --- resolve domain name ---
        raw_domain = _pick_column(example, ("domain", "domains", "style"))
        if isinstance(raw_domain, int):
            domain = domain_names[raw_domain]
        else:
            domain = str(raw_domain)
        # Normalize HF domain spelling to our canonical set if needed.
        if domain not in config.DOMAINS:
            # e.g. "art painting" -> "art_painting"
            domain = domain.replace(" ", "_").lower()

        # --- resolve class name ---
        raw_label = _pick_column(example, ("label", "labels", "class"))
        if isinstance(raw_label, int):
            cls = class_names[raw_label]
        else:
            cls = str(raw_label)

        if domain not in config.DOMAINS or cls not in config.CLASSES:
            # Skip anything that doesn't map cleanly; report once would be noisy.
            continue

        # --- derive a stable stem ---
        original = _pick_column(example, ("file_name", "filename", "path", "image_file"))
        if original:
            stem = _slugify_stem(original)
        else:
            key = (domain, cls)
            idx = counters.get(key, 0)
            counters[key] = idx + 1
            # zero-padded so lexical sort == numeric sort
            stem = f"{idx:05d}"

        # --- write the JPEG ---
        out_path = config.RAW_DIR / domain / cls / f"{stem}.jpg"
        out_path.parent.mkdir(parents=True, exist_ok=True)

        image = example["image"]  # a PIL.Image from the `datasets` Image feature
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.save(out_path, format="JPEG", quality=95)
        written += 1

    print(f"Done. Wrote {written} images under {config.RAW_DIR}")


if __name__ == "__main__":
    main()
