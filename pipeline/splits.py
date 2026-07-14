"""Stratified train/val/test split for the manifest.

The game draws ONLY from the training split; val/test are held out so they never
appear in collected invariant pairs (SPEC §3, §5.1). The split is stratified per
(domain, class) cell and seeded, so it is deterministic and balanced across every
domain×class combination — which keeps all four domains available for cross-domain
pairing while still holding out a clean evaluation set.

NOTE on policy: this is a within-domain stratified split (every domain stays
present in train), which is what the cross-domain pairing game needs. It is NOT
the leave-one-domain-out (LODO) protocol PACS uses for DG benchmarking — flag to
the PI if a LODO-style hold-out of a whole domain is wanted instead.

Stdlib only.
"""

from __future__ import annotations

import random
from collections import defaultdict


def assign_splits(
    image_ids,
    ratios: dict[str, float],
    seed: int,
) -> dict[str, str]:
    """Map each image id to "train" | "val" | "test", stratified per (domain,class).

    image_ids: iterable of "<domain>/<class>/<stem>" ids.
    ratios:    e.g. {"train": 0.8, "val": 0.1, "test": 0.1}. test = remainder, so
               the values need not sum to exactly 1.0.
    seed:      RNG seed for reproducible shuffling.
    """
    rng = random.Random(seed)
    cells: dict[tuple[str, str], list[str]] = defaultdict(list)
    for iid in image_ids:
        domain, cls, _ = iid.split("/", 2)
        cells[(domain, cls)].append(iid)

    train_r = ratios.get("train", 0.8)
    val_r = ratios.get("val", 0.1)

    out: dict[str, str] = {}
    for key in sorted(cells):  # sort cells, then shuffle within — fully deterministic
        members = sorted(cells[key])
        rng.shuffle(members)
        n = len(members)
        n_train = round(n * train_r)
        n_val = round(n * val_r)
        for i, iid in enumerate(members):
            if i < n_train:
                out[iid] = "train"
            elif i < n_train + n_val:
                out[iid] = "val"
            else:
                out[iid] = "test"
    return out
