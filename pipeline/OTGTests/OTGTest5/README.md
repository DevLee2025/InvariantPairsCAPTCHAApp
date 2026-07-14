---
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
