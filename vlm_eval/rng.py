"""vlm_eval/rng.py

Deterministic Mulberry32 PRNG and PACS round draw generator.
Mirrors `web/src/lib/random.ts`, `selection.ts`, and `round.ts` bit-for-bit
so VLM simulations reproduce exact puzzle sequences given a seed.
"""

from __future__ import annotations
import math
import random
from typing import Any, Dict, List, Optional, Set, Tuple

DOMAINS = ["photo", "art_painting", "cartoon", "sketch"]
CLASSES = ["dog", "elephant", "giraffe", "guitar", "horse", "house", "person"]
RECENT_BUFFER = 120


class Mulberry32:
    """Python implementation of 32-bit Mulberry32 PRNG."""
    def __init__(self, seed: int):
        self.a = (seed & 0xFFFFFFFF)

    def next_float(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = (self.a ^ (self.a >> 15)) * (1 | self.a) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * (61 | t) & 0xFFFFFFFF)) ^ t & 0xFFFFFFFF
        return (((t ^ (t >> 14)) & 0xFFFFFFFF) >> 0) / 4294967296.0

def make_rng(seed: int):
    m = Mulberry32(seed)
    return m.next_float

def rand_int(rng_fn, n: int) -> int:
    return math.floor(rng_fn() * n)

def pick_one(rng_fn, arr: list):
    return arr[rand_int(rng_fn, len(arr))]

def shuffle(rng_fn, arr: list) -> list:
    out = list(arr)
    for i in range(len(out) - 1, 0, -1):
        j = rand_int(rng_fn, i + 1)
        out[i], out[j] = out[j], out[i]
    return out

def pair_domains(pair: str) -> Optional[Tuple[str, str]]:
    if pair in ("random", "random_single"):
        return None
    parts = pair.split("↔")
    return (parts[0], parts[1])

def partner_domain(pair: str, anchor_domain: str) -> Optional[str]:
    ds = pair_domains(pair)
    if not ds:
        return None
    return ds[1] if anchor_domain == ds[0] else ds[0]

def resolve_partner(rng_fn, pair: str, anchor_domain: str, all_domains: list) -> Optional[str]:
    if pair == "random_single":
        others = [d for d in all_domains if d != anchor_domain]
        if not others:
            return None
        return others[math.floor(rng_fn() * len(others))]
    return partner_domain(pair, anchor_domain)

def choose_anchor_domain(rng_fn, pair: str, all_domains: list) -> str:
    ds = pair_domains(pair)
    if ds:
        return ds[0] if rng_fn() < 0.5 else ds[1]
    return all_domains[math.floor(rng_fn() * len(all_domains))]

def build_pool(rng_fn, anchor: dict, images: list, partner_dom: Optional[str], recently_shown: Set[str], min_needed: int) -> list:
    same_class = [img for img in images if img["class"] == anchor["class"] and img["id"] != anchor["id"]]
    
    def in_partner(img):
        return (img["domain"] != anchor["domain"]) if partner_dom is None else (img["domain"] == partner_dom)
    
    tier1 = [img for img in same_class if in_partner(img) and img["id"] not in recently_shown]
    pool = shuffle(rng_fn, tier1)
    have = {img["id"] for img in pool}
    
    if len(pool) < min_needed:
        tier2 = [img for img in same_class if in_partner(img) and img["id"] not in have]
        for img in shuffle(rng_fn, tier2):
            pool.append(img)
            have.add(img["id"])
            
    if len(pool) < min_needed:
        tier3 = [img for img in same_class if img["domain"] != anchor["domain"] and img["id"] not in have]
        for img in shuffle(rng_fn, tier3):
            pool.append(img)
            have.add(img["id"])
            
    return pool

def generate_round(
    rng_fn,
    images: list,
    active_split: str = "train",
    mode_id: str = "cross_domain",
    pairing: str = "random_single",
    grid_size: int = 3,
    used_anchor_ids: Optional[Set[str]] = None,
    recently_shown: Optional[Set[str]] = None
) -> Optional[dict]:
    if used_anchor_ids is None:
        used_anchor_ids = set()
    if recently_shown is None:
        recently_shown = set()
        
    count = grid_size * grid_size
    split_images = [img for img in images if img.get("split") == active_split]
    
    for _ in range(300):
        anchor_dom = choose_anchor_domain(rng_fn, pairing, DOMAINS)
        anchor_pool = [img for img in split_images if img["domain"] == anchor_dom and img["id"] not in used_anchor_ids]
        if not anchor_pool:
            continue
            
        anchor = pick_one(rng_fn, anchor_pool)
        partner = resolve_partner(rng_fn, pairing, anchor["domain"], DOMAINS)
        pool = build_pool(rng_fn, anchor, split_images, partner, recently_shown, count)
        if len(pool) < count:
            continue
            
        candidates = pool[:count]
        return {
            "anchor": anchor,
            "options": candidates,
            "partnerDomain": partner,
            "poolSize": len(pool)
        }
    return None
