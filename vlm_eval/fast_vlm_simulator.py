"""vlm_eval/fast_vlm_simulator.py

Fast direct batch simulator for VLM invariant pair collection.
Iterates over deterministic puzzle rounds using `vlm_eval/rng.py`, queries
`vlm_eval/vlm_model.py`, and serializes valid GameRecord v3 JSON files.
"""

from __future__ import annotations
import argparse
import datetime
import json
from pathlib import Path
import time
from typing import Any, Dict, List

from rng import make_rng, generate_round, RECENT_BUFFER
from vlm_model import VLMEvaluator

def run_simulation(
    num_rounds: int = 20,
    seed: int = 1337,
    backend: str = "clip",
    grid_size: int = 3,
    output_path: Optional[Path] = None
) -> Path:
    manifest_path = Path("web/public/manifest.json")
    if not manifest_path.exists():
        manifest_path = Path("web/public/manifest.sample.json")
        
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
        
    images = manifest["images"]
    rng_fn = make_rng(seed)
    
    evaluator = VLMEvaluator(backend=backend, manifest_path=manifest_path)
    
    used_anchor_ids = set()
    recently_shown = set()
    recently_list = []
    
    puzzles = []
    total_pairs = 0
    start_time = time.time()
    
    print(f"\n=======================================================")
    print(f"   STARTING FAST VLM SIMULATION ({num_rounds} rounds, seed={seed})")
    print(f"=======================================================\n")
    
    for round_idx in range(num_rounds):
        round_data = generate_round(
            rng_fn=rng_fn,
            images=images,
            active_split="train",
            mode_id="cross_domain",
            pairing="random_single",
            grid_size=grid_size,
            used_anchor_ids=used_anchor_ids,
            recently_shown=recently_shown
        )
        
        if not round_data:
            print(f"[Warning] Could not generate round {round_idx+1}. Skipping.")
            continue
            
        anchor = round_data["anchor"]
        options = round_data["options"]
        used_anchor_ids.add(anchor["id"])
        
        for opt in options:
            recently_shown.add(opt["id"])
            recently_list.append(opt["id"])
            if len(recently_list) > RECENT_BUFFER:
                oldest = recently_list.pop(0)
                recently_shown.remove(oldest)
                
        # Evaluate puzzle with VLM/CLIP model
        t0 = time.time()
        selected_indices = evaluator.evaluate_puzzle(anchor, options)
        dur_ms = int((time.time() - t0) * 1000) + 150 # simulate realistic decision time
        
        selections = []
        for idx in selected_indices:
            opt = options[idx]
            selections.append({
                "id": opt["id"],
                "position": idx + 1,
                "domain": opt["domain"],
                "class": opt["class"],
                "pickedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()
            })
            
        no_good = len(selections) == 0
        total_pairs += len(selections)
        
        # Build GameRecord v3 puzzle entry
        puzzle_record = {
            "puzzleIndex": round_idx,
            "mode": "cross_domain",
            "domainPairing": "random_single",
            "anchor": {
                "id": anchor["id"],
                "domain": anchor["domain"],
                "class": anchor["class"],
                "file": anchor["file"],
                "url": anchor.get("url", "")
            },
            "options": [
                {
                    "id": opt["id"],
                    "domain": opt["domain"],
                    "class": opt["class"],
                    "file": opt["file"],
                    "url": opt.get("url", ""),
                    "position": pos + 1
                }
                for pos, opt in enumerate(options)
            ],
            "selections": selections,
            "selectionScores": {},
            "selectedPosition": selections[0]["position"] if selections else None,
            "selected": selections[0] if selections else None,
            "noGood": no_good,
            "shownAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "selectedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "durationMs": dur_ms,
            "reviewFlag": False,
            "playerNote": f"VLM auto-selected {len(selections)} invariant pairs (backend={backend}).",
            "screenshotIndex": round_idx
        }
        puzzles.append(puzzle_record)
        
        print(f"Round {round_idx+1:02d}/{num_rounds}: Anchor = {anchor['domain']}/{anchor['class']} | "
              f"Picked {len(selections)} candidate pairs ({dur_ms}ms)")
              
    elapsed_ms = int((time.time() - start_time) * 1000)
    avg_ms = elapsed_ms // max(1, len(puzzles))
    
    # Construct complete GameRecord v3 object
    game_id = f"vlm-game-{datetime.datetime.now().strftime('%Y%m%dT%H%M%S')}"
    game_record = {
        "schemaVersion": 3,
        "game": {
            "gameId": game_id,
            "sessionId": f"session-{seed}",
            "seed": seed,
            "algoVersion": 1,
            "mode": "cross_domain",
            "domainPairing": "random_single",
            "gridSize": grid_size,
            "optionCount": grid_size * grid_size,
            "split": "train",
            "manifest": {
                "version": manifest.get("version", 1),
                "imageCount": len(images),
                "hash": manifest.get("hash", "")
            },
            "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "endedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "timing": {
                "overallMs": elapsed_ms,
                "averageMs": avg_ms,
                "medianMs": avg_ms,
                "perCaptchaMs": avg_ms
            }
        },
        "puzzles": puzzles,
        "reviewerAnnotations": []
    }
    
    out_dir = Path("vlm_eval/out")
    out_dir.mkdir(parents=True, exist_ok=True)
    
    if output_path is None:
        output_path = out_dir / f"grit-game-vlm-{backend}-dev.json"
        
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(game_record, f, indent=2)
        
    print(f"\n=======================================================")
    print(f" SIMULATION COMPLETE!")
    print(f" Total Puzzles: {len(puzzles)}")
    print(f" Total Invariant Pairs Collected: {total_pairs}")
    print(f" Saved GameRecord v3 JSON: {output_path}")
    print(f"=======================================================\n")
    
    return output_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Fast VLM Direct Batch Simulator")
    parser.add_argument("--rounds", type=int, default=20, help="Number of rounds to simulate")
    parser.add_argument("--seed", type=int, default=1337, help="Random seed for reproducibility")
    parser.add_argument("--backend", type=str, default="clip", choices=["clip", "vlm"], help="VLM evaluator backend")
    args = parser.parse_args()
    
    run_simulation(num_rounds=args.rounds, seed=args.seed, backend=args.backend)
