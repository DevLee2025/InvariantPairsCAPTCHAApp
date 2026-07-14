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
import splits

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

    # Seeded stratified split — identical to the manifest's (assign_splits sorts
    # internally, so id order doesn't matter). Probes FIT on train rows only and
    # PREDICT for every image, so val/test probs are out-of-sample.
    split_map = splits.assign_splits(ids, config.SPLIT_RATIOS, config.SPLIT_SEED)
    manifest_path = config.PIPELINE_DIR.parent / "web" / "public" / "manifest.json"
    if manifest_path.exists():
        manifest_split = {
            im["id"]: im["split"]
            for im in json.loads(manifest_path.read_text(encoding="utf-8"))["images"]
        }
        bad = [i for i in ids if manifest_split.get(i) != split_map[i]]
        if bad:
            raise SystemExit(
                f"Split mismatch vs manifest for {len(bad)} ids (e.g. {bad[:3]})."
            )
        print(f"Split agrees with web/public/manifest.json for all {len(ids)} ids.")

    train_rows = np.array([r for r, i in enumerate(ids) if split_map[i] == "train"])
    val_rows = np.array([r for r, i in enumerate(ids) if split_map[i] == "val"])

    # -------------------------------------------------------------------
    # (a) ERM probe, fit on the train split (all 4 domains).
    # -------------------------------------------------------------------
    print(f"Training ERM probe on the train split ({len(train_rows)} of {len(ids)}) ...")
    # NOTE: no multi_class kwarg — removed in modern scikit-learn; multinomial is
    # the default for the lbfgs solver.
    erm = LogisticRegression(
        max_iter=2000,
        C=1.0,
    )
    erm.fit(emb[train_rows], y_all[train_rows])
    erm_proba = _reproject_to_class_order(erm.predict_proba(emb), erm.classes_)
    pred = erm_proba.argmax(axis=1)
    acc_train = float((pred[train_rows] == y_all[train_rows]).mean())
    acc_val = float((pred[val_rows] == y_all[val_rows]).mean())
    print(f"  ERM probe accuracy — train {acc_train:.3f} · val {acc_val:.3f}")
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
    pc_ids = [ids[r] for r in pc_rows]
    # Fit subset: train-split photo+cartoon rows only (predictions cover all).
    pc_train = [r for r in pc_rows if split_map[ids[r]] == "train"]
    pc_train_emb = emb[pc_train]
    pc_train_y = y_all[pc_train]
    pc_train_domains = [domains_all[r] for r in pc_train]
    print(
        f"photo+cartoon subset: {len(pc_rows)} images "
        f"({len(pc_train)} train used for fitting)."
    )

    rng = np.random.default_rng(RANDOM_STATE)
    # mix_probs[id] = {ratioName: [7 floats]}
    mix_probs: dict[str, dict[str, list[float]]] = {iid: {} for iid in pc_ids}

    for ratio_name, (photo_frac, cartoon_frac) in config.MIX_RATIOS.items():
        print(f"Training mixture probe '{ratio_name}' "
              f"({photo_frac:.0%}:{cartoon_frac:.0%} photo:cartoon) ...")
        idx = _resample_indices(pc_train_domains, photo_frac, cartoon_frac, rng)
        X_train = pc_train_emb[idx]
        y_train = pc_train_y[idx]

        clf = LogisticRegression(
            max_iter=2000,
            C=1.0,
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
