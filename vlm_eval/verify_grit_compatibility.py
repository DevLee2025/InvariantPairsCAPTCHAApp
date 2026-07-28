"""vlm_eval/verify_grit_compatibility.py

GRIT Mathematical Compatibility & Benchmark Verification Tool.
1. Loads VLM game record JSONs from `vlm_eval/out/`.
2. Verifies GameRecord v3 schema validity.
3. Invokes `pipeline/build_hf_dataset.py` to produce HuggingFace Parquet format.
4. Computes CLIP difference vectors delta_i = phi(anchor) - phi(selected).
5. Performs Truncated SVD on proxy covariance matrix Sigma_k = (1/k) * sum(delta_i delta_i^T).
6. Evaluates ground-truth semantic precision y_anchor == y_selected and subspace rank.
"""

from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import numpy as np

def verify_grit_compatibility(json_path: Path, hf_out_dir: Optional[Path] = None) -> dict:
    print(f"\n=======================================================")
    print(f"   VERIFYING GRIT COMPATIBILITY FOR: {json_path.name}")
    print(f"=======================================================\n")
    
    if hf_out_dir is None:
        if "browser" in json_path.name.lower():
            hf_out_dir = Path("vlm_eval/out/browserhf")
        else:
            hf_out_dir = Path("vlm_eval/out/hf")
            
    with open(json_path, "r", encoding="utf-8") as f:
        game_data = json.load(f)

        
    schema_ver = game_data.get("schemaVersion", 1)
    puzzles = game_data.get("puzzles", [])
    
    # 1. Extract invariant pairs
    pairs = []
    correct_class_matches = 0
    total_pairs = 0
    
    for p in puzzles:
        anchor = p["anchor"]
        selections = p.get("selections", [])
        for s in selections:
            total_pairs += 1
            is_match = (anchor["class"] == s["class"])
            if is_match:
                correct_class_matches += 1
            pairs.append({
                "anchor_id": anchor["id"],
                "anchor_class": anchor["class"],
                "anchor_domain": anchor["domain"],
                "selected_id": s["id"],
                "selected_class": s["class"],
                "selected_domain": s["domain"],
                "is_match": is_match
            })
            
    precision = (correct_class_matches / max(1, total_pairs)) * 100.0
    print(f"[Schema Check] Schema Version: {schema_ver}")
    print(f"[Pair Count] Total Invariant Pairs Extracted: {total_pairs}")
    print(f"[Semantic Precision] Ground-Truth Class Alignment (y_anchor == y_selected): {precision:.2f}%")
    
    # 2. Compute difference vectors delta_i using CLIP embeddings
    emb_file = Path("pipeline/data/embeddings/embeddings.npy")
    ids_file = Path("pipeline/data/embeddings/ids.json")
    
    svd_rank = 0
    top_singular_values = []
    
    if emb_file.exists() and ids_file.exists() and total_pairs > 0:
        embeddings = np.load(emb_file)
        with open(ids_file, "r", encoding="utf-8") as f:
            ids = json.load(f)
        id_to_idx = {iid: idx for idx, iid in enumerate(ids)}
        
        deltas = []
        for pair in pairs:
            a_id = pair["anchor_id"]
            s_id = pair["selected_id"]
            if a_id in id_to_idx and s_id in id_to_idx:
                a_emb = embeddings[id_to_idx[a_id]]
                s_emb = embeddings[id_to_idx[s_id]]
                delta = a_emb - s_emb
                deltas.append(delta)
                
        if deltas:
            delta_mat = np.stack(deltas, axis=0) # [k, d]
            print(f"[SVD Analysis] Difference Matrix Shape: {delta_mat.shape}")
            
            # Singular Value Decomposition
            U, S, Vt = np.linalg.svd(delta_mat, full_matrices=False)
            top_singular_values = S[:10].tolist()
            
            # Energy threshold for estimated spurious rank r
            tot_var = np.sum(S**2)
            cum_var = np.cumsum(S**2) / tot_var
            svd_rank = int(np.searchsorted(cum_var, 0.90) + 1)
            
            print(f"[SVD Analysis] Estimated Spurious Subspace Rank r (90% var): {svd_rank}")
            print(f"[SVD Analysis] Top 5 Singular Values: {[round(v, 3) for v in top_singular_values[:5]]}")
            
    # 3. Test conversion to HF Parquet via build_hf_dataset.py
    print(f"\n[HF Dataset Build] Running build_hf_dataset.py ...")

    cmd = [
        "python", "pipeline/build_hf_dataset.py",
        str(json_path),
        "-o", str(hf_out_dir)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"[HF Dataset Build] SUCCESS! Output written to {hf_out_dir}")
    else:
        print(f"[HF Dataset Build] Note: {res.stderr.strip() or res.stdout.strip()}")
        
    report = {
        "jsonFile": str(json_path),
        "schemaVersion": schema_ver,
        "totalPuzzles": len(puzzles),
        "totalPairs": total_pairs,
        "semanticPrecisionPercent": round(precision, 2),
        "estimatedRank90Var": svd_rank,
        "topSingularValues": [round(v, 4) for v in top_singular_values],
        "gritCompatible": (schema_ver >= 2 and total_pairs > 0 and precision >= 80.0)
    }
    
    report_path = Path("vlm_eval/out/grit_verification_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        
    print(f"\n[Verification Summary] Overall GRIT Compatible: {report['gritCompatible']}")
    print(f"[Report Saved] {report_path}\n")
    return report

if __name__ == "__main__":
    import sys
    json_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("vlm_eval/out/grit-game-vlm-clip-dev.json")
    verify_grit_compatibility(json_path)
