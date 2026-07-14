"""Build a HuggingFace-ready invariant-pairs dataset from saved game JSON(s).

WHY: the game JSON exported by the app is ONE game object (one row, nested) —
committing it to a HF repo yields a single massive entry and a size-incoherence
error. A plain JSON also can't make HF render embedded images in its no-code
viewer (that needs a Parquet with embedded image bytes, or a loading script).

This script flattens to ONE ROW PER PAIR with embedded, viewable images:
  - all metadata retained as flat columns (no empty structs)
  - anchor_image + selected_image embedded → rendered by the HF dataset viewer
  - --include-options also embeds every option image
Images are read from the local PACS dir (web/public/pacs) by id.

Usage:
  python build_hf_dataset.py <game.json | folder> [-o OUT] [--include-options]

Outputs (in OUT, default pipeline/out/hf):
  invariant_pairs.parquet         ← COMMIT THIS to the HF dataset repo (images render)
  invariant_pairs_metadata.jsonl  ← human-readable metadata companion (no image bytes)
  README.md                       ← dataset card (declares the parquet as the train split)
  dataset/                        ← datasets save_to_disk (for load_from_disk().push_to_hub)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
WEB_PUBLIC = PIPELINE_DIR.parent / "web" / "public"
PACS_DIR = WEB_PUBLIC / "pacs"

# Columns that hold image bytes (excluded from the metadata-only JSONL companion).
IMAGE_COLS = {"anchor_image", "selected_image", "option_images"}


def find_games(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    return sorted(input_path.glob("**/grit-game*.json"))


def load_image(image_id: str) -> dict | None:
    """Return {'bytes', 'path'} for the HF Image feature, or None if missing."""
    p = PACS_DIR / f"{image_id}.jpg"
    if not p.exists():
        return None
    return {"bytes": p.read_bytes(), "path": f"{image_id}.jpg"}


def rows_from_game(game: dict, include_options: bool) -> list[dict]:
    g = game["game"]
    m = g.get("manifest", {})
    t = g.get("timing", {})
    ann = {a["puzzleIndex"]: a["comment"] for a in game.get("reviewerAnnotations", [])}
    out: list[dict] = []
    for p in game["puzzles"]:
        # "No good options" puzzles are not invariant pairs — exclude from the dataset.
        if p.get("noGood") or p.get("selected") is None:
            continue
        a, sel = p["anchor"], p["selected"]
        anchor_img = load_image(a["id"])
        selected_img = load_image(sel["id"])
        if anchor_img is None or selected_img is None:
            print(f"  ! skip {g['gameId']}#{p['puzzleIndex']} — missing anchor/selected image on disk")
            continue
        opts = p["options"]
        row = {
            # identity
            "pair_id": f"{g['gameId']}#{p['puzzleIndex']}",
            "game_id": g["gameId"],
            "session_id": g.get("sessionId", ""),
            "puzzle_index": int(p["puzzleIndex"]),
            # game config (retained per row for filtering/grouping)
            "seed": int(g["seed"]),
            "algo_version": int(g.get("algoVersion", 1)),
            "mode": p.get("mode", g["mode"]),
            "domain_pairing": p.get("domainPairing", g.get("domainPairing", "")),
            "grid_size": int(g["gridSize"]),
            "option_count": int(g.get("optionCount", len(opts))),
            "split": g.get("split", "train"),
            # anchor
            "anchor_id": a["id"],
            "anchor_domain": a["domain"],
            "anchor_class": a["class"],
            "anchor_split": a.get("split", ""),
            "anchor_url": a.get("url", ""),
            # selection
            "selected_position": int(p["selectedPosition"]),
            "selected_id": sel["id"],
            "selected_domain": sel["domain"],
            "selected_class": sel["class"],
            "selected_split": sel.get("split", ""),
            "selected_url": sel.get("url", ""),
            # timing / annotations / provenance
            "duration_ms": int(p.get("durationMs", 0)),
            "shown_at": p.get("shownAt", ""),
            "selected_at": p.get("selectedAt", ""),
            "review_flag": bool(p.get("reviewFlag", False)),
            "player_note": p.get("playerNote", "") or "",
            "reviewer_comment": ann.get(p["puzzleIndex"], ""),
            "screenshot_index": p.get("screenshotIndex"),
            # all options (metadata)
            "n_options": len(opts),
            "option_positions": [int(o["position"]) for o in opts],
            "option_ids": [o["id"] for o in opts],
            "option_domains": [o["domain"] for o in opts],
            "option_classes": [o["class"] for o in opts],
            "option_urls": [o.get("url", "") for o in opts],
            # manifest pin + game timing
            "manifest_hash": m.get("hash", ""),
            "manifest_version": int(m.get("version", 0)),
            "manifest_image_count": int(m.get("imageCount", 0)),
            "game_started_at": g.get("startedAt", ""),
            "game_ended_at": g.get("endedAt") or "",
            "game_overall_ms": int(t.get("overallMs") or 0),
            "game_average_ms": int(t.get("averageMs") or 0),
            "game_median_ms": int(t.get("medianMs") or 0),
            # embedded images (rendered by the HF viewer)
            "anchor_image": anchor_img,
            "selected_image": selected_img,
        }
        if include_options:
            imgs = [load_image(o["id"]) for o in opts]
            row["option_images"] = imgs if all(i is not None for i in imgs) else []
        out.append(row)
    return out


def features(include_options: bool):
    from datasets import Features, Image, Sequence, Value

    f = {
        "pair_id": Value("string"),
        "game_id": Value("string"),
        "session_id": Value("string"),
        "puzzle_index": Value("int32"),
        "seed": Value("int64"),
        "algo_version": Value("int32"),
        "mode": Value("string"),
        "domain_pairing": Value("string"),
        "grid_size": Value("int32"),
        "option_count": Value("int32"),
        "split": Value("string"),
        "anchor_id": Value("string"),
        "anchor_domain": Value("string"),
        "anchor_class": Value("string"),
        "anchor_split": Value("string"),
        "anchor_url": Value("string"),
        "selected_position": Value("int32"),
        "selected_id": Value("string"),
        "selected_domain": Value("string"),
        "selected_class": Value("string"),
        "selected_split": Value("string"),
        "selected_url": Value("string"),
        "duration_ms": Value("int64"),
        "shown_at": Value("string"),
        "selected_at": Value("string"),
        "review_flag": Value("bool"),
        "player_note": Value("string"),
        "reviewer_comment": Value("string"),
        "screenshot_index": Value("int32"),
        "n_options": Value("int32"),
        "option_positions": Sequence(Value("int32")),
        "option_ids": Sequence(Value("string")),
        "option_domains": Sequence(Value("string")),
        "option_classes": Sequence(Value("string")),
        "option_urls": Sequence(Value("string")),
        "manifest_hash": Value("string"),
        "manifest_version": Value("int32"),
        "manifest_image_count": Value("int32"),
        "game_started_at": Value("string"),
        "game_ended_at": Value("string"),
        "game_overall_ms": Value("int64"),
        "game_average_ms": Value("int64"),
        "game_median_ms": Value("int64"),
        "anchor_image": Image(),
        "selected_image": Image(),
    }
    if include_options:
        f["option_images"] = Sequence(Image())
    return Features(f)


README = """---
configs:
- config_name: default
  data_files:
  - split: train
    path: invariant_pairs.parquet
---

# GRIT invariant pairs

Human-curated invariant image pairs from PACS (for the GRIT method). One row per
pair: an `anchor_image` and the player's `selected_image` (same object class,
different visual domain), both embedded so they render in the dataset viewer,
plus full provenance (seed, mode, domain pairing, positions, timing, player /
reviewer notes, and the ids/urls of every option shown).
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="game JSON file or a folder of them")
    ap.add_argument("-o", "--out", default=str(PIPELINE_DIR / "out" / "hf"))
    ap.add_argument("--include-options", action="store_true",
                    help="embed all option images too (larger)")
    args = ap.parse_args()

    from datasets import Dataset

    games = find_games(Path(args.input))
    if not games:
        raise SystemExit(f"No game JSON found at {args.input}")
    print(f"Found {len(games)} game file(s).")

    rows: list[dict] = []
    for gp in games:
        game = json.loads(gp.read_text(encoding="utf-8"))
        if game.get("schemaVersion") != 2:
            print(f"  skip {gp.name}: schemaVersion != 2")
            continue
        rows.extend(rows_from_game(game, args.include_options))

    if not rows:
        raise SystemExit("No pairs produced (no images found / no valid games).")

    ds = Dataset.from_list(rows, features=features(args.include_options))

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    parquet_path = out / "invariant_pairs.parquet"
    ds.to_parquet(str(parquet_path))
    ds.save_to_disk(str(out / "dataset"))
    (out / "README.md").write_text(README, encoding="utf-8")

    # metadata-only JSONL companion (no image bytes) for human reading
    jsonl_path = out / "invariant_pairs_metadata.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as fh:
        for r in rows:
            meta = {k: v for k, v in r.items() if k not in IMAGE_COLS}
            fh.write(json.dumps(meta) + "\n")

    print(f"\nDone. {len(ds)} pairs, {len(ds.column_names)} columns.")
    print(f"  COMMIT TO HF : {parquet_path}")
    print(f"  + card       : {out / 'README.md'}")
    print(f"  metadata     : {jsonl_path}  (no images; human-readable)")
    print(f"  dataset/     : {out / 'dataset'}  (load_from_disk(...).push_to_hub('user/name'))")


if __name__ == "__main__":
    main()
