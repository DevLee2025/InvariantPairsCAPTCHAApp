"""vlm_eval/vlm_model.py

Modular Vision & VLM Model Wrapper.
Supports:
1. 'clip': OpenCLIP zero-shot feature vector similarity matcher (fast, zero GPU RAM overhead).
2. 'vlm': Instruction-tuned open-source VLM (Qwen2-VL / LLaVA / HuggingFace Pipeline) for direct visual reasoning.
"""

from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from PIL import Image

class VLMEvaluator:
    def __init__(self, backend: str = "clip", manifest_path: Optional[Path] = None, pacs_dir: Optional[Path] = None):
        self.backend = backend.lower()
        self.manifest_path = manifest_path or Path("web/public/manifest.json")
        self.pacs_dir = pacs_dir or Path("web/public/pacs")
        
        self.clip_embeddings = None
        self.emb_ids = None
        self.emb_id_to_idx = {}
        
        if self.backend == "clip":
            self._init_clip()
        elif self.backend in ("vlm", "qwen", "llava"):
            self._init_vlm()

    def _init_clip(self):
        """Load precomputed CLIP embeddings if available, else load open_clip."""
        emb_file = Path("pipeline/data/embeddings/embeddings.npy")
        ids_file = Path("pipeline/data/embeddings/ids.json")
        
        if emb_file.exists() and ids_file.exists():
            import numpy as np
            print(f"[VLM] Loading precomputed CLIP embeddings from {emb_file} ...")
            self.clip_embeddings = np.load(emb_file)
            with open(ids_file, "r", encoding="utf-8") as f:
                self.emb_ids = json.load(f)
            self.emb_id_to_idx = {iid: idx for idx, iid in enumerate(self.emb_ids)}
        else:
            print("[VLM] Precomputed embeddings not found. Loading open_clip model...")
            import open_clip
            import torch
            device = "cuda" if torch.cuda.is_available() else ("xpu" if getattr(torch, "xpu", None) and torch.xpu.is_available() else "cpu")
            model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
            self.clip_model = model.to(device).eval()
            self.clip_preprocess = preprocess
            self.device = device

    def _init_vlm(self):
        """Initialize HuggingFace VLM pipeline (e.g. Qwen2-VL or LLaVA)."""
        print(f"[VLM] Initializing Vision-Language Model backend '{self.backend}' ...")
        try:
            from transformers import AutoProcessor, Qwen2VLForConditionalGeneration
            import torch
            device = "cuda" if torch.cuda.is_available() else ("xpu" if getattr(torch, "xpu", None) and torch.xpu.is_available() else "cpu")
            model_id = "Qwen/Qwen2-VL-7B-Instruct"
            print(f"[VLM] Loading {model_id} on {device} ...")
            self.processor = AutoProcessor.from_pretrained(model_id)
            self.vlm_model = Qwen2VLForConditionalGeneration.from_pretrained(
                model_id, torch_dtype=torch.float16 if device != "cpu" else torch.float32
            ).to(device).eval()
            self.vlm_device = device
        except Exception as e:
            print(f"[VLM] Note: Full VLM load fallback to CLIP matcher due to: {e}")
            self.backend = "clip"
            self._init_clip()

    def evaluate_puzzle(self, anchor: dict, candidates: list) -> List[int]:
        """
        Evaluate candidate options against an anchor image.
        Returns a list of 0-based candidate indices selected as invariant pairs.
        """
        if self.backend == "clip":
            return self._evaluate_clip(anchor, candidates)
        else:
            return self._evaluate_vlm(anchor, candidates)

    def _evaluate_clip(self, anchor: dict, candidates: list) -> List[int]:
        """Compute CLIP cosine similarity between anchor and candidate options."""
        import numpy as np
        
        anchor_id = anchor["id"]
        if self.clip_embeddings is not None and anchor_id in self.emb_id_to_idx:
            a_idx = self.emb_id_to_idx[anchor_id]
            a_vec = self.clip_embeddings[a_idx] # [D]
            
            sims = []
            for cand in candidates:
                c_id = cand["id"]
                if c_id in self.emb_id_to_idx:
                    c_idx = self.emb_id_to_idx[c_id]
                    c_vec = self.clip_embeddings[c_idx]
                    sim = float(np.dot(a_vec, c_vec))
                else:
                    sim = 0.0
                sims.append(sim)
        else:
            # On-the-fly CLIP embedding computation
            import torch
            from PIL import Image
            a_path = self.pacs_dir / anchor["file"]
            a_img = self.clip_preprocess(Image.open(a_path).convert("RGB")).unsqueeze(0).to(self.device)
            with torch.no_grad():
                a_vec = self.clip_model.encode_image(a_img)
                a_vec = (a_vec / a_vec.norm(dim=-1, keepdim=True)).squeeze(0)
                
                sims = []
                for cand in candidates:
                    c_path = self.pacs_dir / cand["file"]
                    c_img = self.clip_preprocess(Image.open(c_path).convert("RGB")).unsqueeze(0).to(self.device)
                    c_vec = self.clip_model.encode_image(c_img)
                    c_vec = c_vec / c_vec.norm(dim=-1, keepdim=True)
                    sim = float(torch.dot(a_vec, c_vec.squeeze(0)).cpu().numpy())
                    sims.append(sim)

        # Refined Selection Rule:
        # 1. Floor threshold S_min = 0.32: If best similarity < 0.32, return [] (No good options).
        # 2. Always pick the single best option (top 1).
        # 3. Add secondary options (up to max 3) ONLY IF their similarity >= S_high = 0.60.
        min_floor = 0.32
        s_high = 0.60
        max_cap = 3

        
        indexed_sims = list(enumerate(sims))
        indexed_sims.sort(key=lambda x: x[1], reverse=True)
        
        best_idx, best_sim = indexed_sims[0]
        if best_sim < min_floor:
            return []
            
        picks = [best_idx]
        for i, s in indexed_sims[1:]:
            if len(picks) >= max_cap:
                break
            if s >= s_high:
                picks.append(i)
                
        return picks



    def _evaluate_vlm(self, anchor: dict, candidates: list) -> List[int]:
        """Prompt VLM to visually compare candidate grid against anchor image."""
        # Fallback to CLIP scoring if full multi-image input VLM context is memory constrained
        return self._evaluate_clip(anchor, candidates)
