"""Step 02 — Compute frozen-CLIP embeddings and zero-shot 7-class probs.

For every image written by step 01 we:
  1. encode it with a FROZEN open_clip model into a unit-norm embedding,
  2. compute zero-shot class probabilities via softmax over the cosine
     similarities to the 7 class text embeddings
     ("a photo of a {class}" prompts).

Outputs (keyed by stable image id "<domain>/<class>/<stem>"):
  - EMB_DIR/embeddings.npy   : float32 array [N, D]   (L2-normalized)
  - EMB_DIR/ids.json         : list[str] of length N  (row order of the array)
  - PROBS_DIR/clip_probs.json: { id: [7 floats] }     (zero-shot probabilities)

We use **open_clip** (open_clip_torch). The chosen model is configured in
config.CLIP_MODEL_NAME / CLIP_PRETRAINED. CLIP runs on GPU if available, else
CPU (slow but fine for ~10k images).

Heavy deps (torch, open_clip, PIL, numpy) are imported inside main() so this
file is import-safe and `python -m py_compile` passes without them.

Run:
    python 02_compute_clip.py
"""

from __future__ import annotations

import json
from pathlib import Path

import config


def iter_image_paths() -> list[Path]:
    """Return all RAW_DIR/<domain>/<class>/<stem>.jpg paths, sorted for
    deterministic ordering across runs."""
    paths: list[Path] = []
    for domain in config.DOMAINS:
        for cls in config.CLASSES:
            cell = config.RAW_DIR / domain / cls
            if cell.is_dir():
                paths.extend(sorted(cell.glob("*.jpg")))
    return paths


def path_to_id(path: Path) -> str:
    """Map a raw image path to its stable manifest id "<domain>/<class>/<stem>"."""
    # .../raw/<domain>/<class>/<stem>.jpg  ->  <domain>/<class>/<stem>
    return f"{path.parent.parent.name}/{path.parent.name}/{path.stem}"


def main() -> None:
    # Heavy imports kept local.
    import numpy as np  # type: ignore
    import torch  # type: ignore
    import open_clip  # type: ignore
    from PIL import Image  # type: ignore
    from tqdm import tqdm  # type: ignore

    config.ensure_dirs()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading CLIP {config.CLIP_MODEL_NAME}/{config.CLIP_PRETRAINED} on {device} ...")
    model, _, preprocess = open_clip.create_model_and_transforms(
        config.CLIP_MODEL_NAME, pretrained=config.CLIP_PRETRAINED
    )
    model = model.to(device).eval()
    tokenizer = open_clip.get_tokenizer(config.CLIP_MODEL_NAME)

    # --- precompute the 7 class text embeddings (the zero-shot classifier) ---
    prompts = [config.CLIP_PROMPT_TEMPLATE.format(cls=c) for c in config.CLASSES]
    with torch.no_grad():
        text_tokens = tokenizer(prompts).to(device)
        text_feats = model.encode_text(text_tokens)
        text_feats = text_feats / text_feats.norm(dim=-1, keepdim=True)  # [7, D]

    paths = iter_image_paths()
    if not paths:
        raise SystemExit(f"No images found under {config.RAW_DIR}. Run 01 first.")
    print(f"Encoding {len(paths)} images ...")

    ids: list[str] = []
    embeddings: list["np.ndarray"] = []
    clip_probs: dict[str, list[float]] = {}

    # logit scale used by CLIP for the softmax temperature.
    logit_scale = model.logit_scale.exp().detach()

    with torch.no_grad():
        for path in tqdm(paths, desc="clip encode"):
            img = Image.open(path).convert("RGB")
            tensor = preprocess(img).unsqueeze(0).to(device)  # [1, 3, H, W]

            feat = model.encode_image(tensor)
            feat = feat / feat.norm(dim=-1, keepdim=True)  # [1, D], unit norm

            # zero-shot probs: softmax over scaled cosine sims to class texts
            logits = logit_scale * feat @ text_feats.T  # [1, 7]
            probs = logits.softmax(dim=-1).squeeze(0)  # [7]

            iid = path_to_id(path)
            ids.append(iid)
            embeddings.append(feat.squeeze(0).cpu().numpy().astype("float32"))
            clip_probs[iid] = [float(p) for p in probs.cpu().numpy()]

    emb_arr = np.stack(embeddings, axis=0)  # [N, D]
    np.save(config.EMB_DIR / "embeddings.npy", emb_arr)
    (config.EMB_DIR / "ids.json").write_text(json.dumps(ids), encoding="utf-8")
    (config.PROBS_DIR / "clip_probs.json").write_text(
        json.dumps(clip_probs), encoding="utf-8"
    )

    print(f"Saved embeddings {emb_arr.shape} -> {config.EMB_DIR / 'embeddings.npy'}")
    print(f"Saved {len(clip_probs)} clip prob vectors -> "
          f"{config.PROBS_DIR / 'clip_probs.json'}")


if __name__ == "__main__":
    main()
