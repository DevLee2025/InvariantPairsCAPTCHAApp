"""Step 03 — Train linear probes on FROZEN CLIP features.

Using the embeddings saved by step 02 as fixed features, we train multinomial
logistic-regression probes with scikit-learn and predict per-image 7-class
probability vectors:

  (a) ERM probe — trained on the FULL training split (all 4 domains) -> ermProbs
      for every image.

  (b) THREE mixture probes — trained on the photo+cartoon subset only, with the
      subset RESAMPLED to a target photo:cartoon ratio:
          balanced     50:50
          photoHeavy   90:10
          cartoonHeavy 10:90
      Each probe predicts 7-class probs for every photo & cartoon image ->
      mix.{balanced,photoHeavy,cartoonHeavy}.

Outputs (keyed by image id):
  - PROBS_DIR/erm_probs.json : { id: [7 floats] }   (all images)
  - PROBS_DIR/mix_probs.json : { id: {balanced:[7], photoHeavy:[7],
                                      cartoonHeavy:[7]} }  (photo+cartoon only)

Notes on probability alignment: LogisticRegression orders its output columns by
`clf.classes_`. We always reproject predictions back into config.CLASSES order
so every stored vector is indexed consistently with the manifest contract.

Heavy deps (numpy, scikit-learn) imported inside main(); import-safe.

Run (after 02):
    python 03_train_probes.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import config

# Reproducible resampling.
RANDOM_STATE = 0


def _load_ids_and_embeddings():
    """Load the row-aligned ids list and embeddings matrix from step 02."""
    import numpy as np  # type: ignore

    ids_path = config.EMB_DIR / "ids.json"
    emb_path = config.EMB_DIR / "embeddings.npy"
    if not ids_path.exists() or not emb_path.exists():
        raise SystemExit("Missing embeddings/ids. Run 02_compute_clip.py first.")

    ids = json.loads(ids_path.read_text(encoding="utf-8"))
    emb = np.load(emb_path)
    if len(ids) != emb.shape[0]:
        raise SystemExit(
            f"ids ({len(ids)}) and embeddings ({emb.shape[0]}) length mismatch."
        )
    return ids, emb


def _id_domain(iid: str) -> str:
    """Domain component of "<domain>/<class>/<stem>"."""
    return iid.split("/", 1)[0]


def _id_class(iid: str) -> str:
    """Class component of "<domain>/<class>/<stem>"."""
    return iid.split("/")[1]


def _reproject_to_class_order(proba, clf_classes):
    """Reorder a [N, k] proba matrix into config.CLASSES order.

    `clf_classes` are the (integer) class labels the model was trained on, which
    are indices into config.CLASSES. Any class absent from a training subset
    gets a zero column so every output row has length 7.
    """
    import numpy as np  # type: ignore

    n = proba.shape[0]
    full = np.zeros((n, len(config.CLASSES)), dtype="float64")
    for col, cls_idx in enumerate(clf_classes):
        full[:, int(cls_idx)] = proba[:, col]
    return full


def _resample_indices(domains, photo_frac, cartoon_frac, rng):
    """Build resampled row indices for a photo:cartoon target ratio.

    We keep the larger group at its natural size and oversample (with
    replacement) the smaller group so the realized ratio matches the target.
    `domains` is a list aligned to the photo+cartoon subset rows.
    """
    photo_idx = [i for i, d in enumerate(domains) if d == "photo"]
    cartoon_idx = [i for i, d in enumerate(domains) if d == "cartoon"]
    if not photo_idx or not cartoon_idx:
        raise SystemExit("photo+cartoon subset is missing one of the domains.")

    # Anchor total count on the available data, then split by the target ratio.
    total = len(photo_idx) + len(cartoon_idx)
    n_photo = max(1, round(total * photo_frac))
    n_cartoon = max(1, round(total * cartoon_frac))

    # Sample with replacement so we can up-weight the minority side.
    sel_photo = rng.choice(photo_idx, size=n_photo, replace=True)
    sel_cartoon = rng.choice(cartoon_idx, size=n_cartoon, replace=True)
    out = list(sel_photo) + list(sel_cartoon)
    rng.shuffle(out)
    return out


def main() -> None:
    import numpy as np  # type: ignore
    from sklearn.linear_model import LogisticRegression  # type: ignore

    config.ensure_dirs()
    ids, emb = _load_ids_and_embeddings()

    class_to_idx = {c: i for i, c in enumerate(config.CLASSES)}
    y_all = np.array([class_to_idx[_id_class(i)] for i in ids], dtype="int64")
    domains_all = [_id_domain(i) for i in ids]

    # -------------------------------------------------------------------
    # (a) ERM probe on the full split.
    # -------------------------------------------------------------------
    print("Training ERM probe on full split ...")
    erm = LogisticRegression(
        max_iter=2000,
        C=1.0,
        multi_class="multinomial",
        n_jobs=-1,
    )
    erm.fit(emb, y_all)
    erm_proba = _reproject_to_class_order(erm.predict_proba(emb), erm.classes_)
    erm_probs = {iid: [float(p) for p in erm_proba[r]] for r, iid in enumerate(ids)}
    (config.PROBS_DIR / "erm_probs.json").write_text(
        json.dumps(erm_probs), encoding="utf-8"
    )
    print(f"  saved {len(erm_probs)} erm prob vectors.")

    # -------------------------------------------------------------------
    # (b) Three mixture probes on the photo+cartoon subset.
    # -------------------------------------------------------------------
    pc_rows = [r for r, d in enumerate(domains_all) if d in config.MIX_DOMAINS]
    pc_emb = emb[pc_rows]
    pc_y = y_all[pc_rows]
    pc_domains = [domains_all[r] for r in pc_rows]
    pc_ids = [ids[r] for r in pc_rows]
    print(f"photo+cartoon subset: {len(pc_rows)} images.")

    rng = np.random.default_rng(RANDOM_STATE)
    # mix_probs[id] = {ratioName: [7 floats]}
    mix_probs: dict[str, dict[str, list[float]]] = {iid: {} for iid in pc_ids}

    for ratio_name, (photo_frac, cartoon_frac) in config.MIX_RATIOS.items():
        print(f"Training mixture probe '{ratio_name}' "
              f"({photo_frac:.0%}:{cartoon_frac:.0%} photo:cartoon) ...")
        idx = _resample_indices(pc_domains, photo_frac, cartoon_frac, rng)
        X_train = pc_emb[idx]
        y_train = pc_y[idx]

        clf = LogisticRegression(
            max_iter=2000,
            C=1.0,
            multi_class="multinomial",
            n_jobs=-1,
        )
        clf.fit(X_train, y_train)
        proba = _reproject_to_class_order(clf.predict_proba(pc_emb), clf.classes_)
        for r, iid in enumerate(pc_ids):
            mix_probs[iid][ratio_name] = [float(p) for p in proba[r]]

    (config.PROBS_DIR / "mix_probs.json").write_text(
        json.dumps(mix_probs), encoding="utf-8"
    )
    print(f"  saved mixture probs for {len(mix_probs)} photo+cartoon images.")
    print("Done.")


if __name__ == "__main__":
    main()
