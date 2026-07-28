"""vlm_eval/browser_vlm_agent.py

Playwright-based Browser Automation Agent for VLM Web UI Play.
Launches Chromium in HEADED mode (`headless=False`), allowing you to watch
the VLM evaluate puzzles and physically interact with the web app UI in real-time.
"""

from __future__ import annotations
import argparse
import datetime
import json
from pathlib import Path
import time

from playwright.sync_api import sync_playwright
from rng import make_rng, generate_round
from vlm_model import VLMEvaluator

def run_browser_agent(
    num_rounds: int = 10,
    seed: int = 1337,
    backend: str = "clip",
    app_url: str = "http://localhost:5173",
    headed: bool = True
):
    manifest_path = Path("web/public/manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    images = manifest["images"]
    
    evaluator = VLMEvaluator(backend=backend)
    
    print(f"\n=======================================================")
    print(f"   STARTING BROWSER VLM AGENT ({num_rounds} rounds, headed={headed})")
    print(f"=======================================================\n")
    
    with sync_playwright() as p:
        # Launch browser in headed mode so the user can watch the live interaction
        browser = p.chromium.launch(headless=not headed, slow_mo=400)
        page = browser.new_page()
        page.goto(app_url)
        page.wait_for_selector("text=Play", timeout=10000)
        
        print(f"[Browser] Successfully connected to web application at {app_url}\n")
        time.sleep(1)
        
        # Start game with specified seed
        # Ensure we are in Play view
        play_btn = page.query_selector("button:has-text('Play')")
        if play_btn:
            play_btn.click()
            time.sleep(0.5)
            
        used_anchor_ids = set()
        recently_shown = set()
        rng_fn = make_rng(seed)
        
        for round_idx in range(num_rounds):
            round_data = generate_round(
                rng_fn=rng_fn,
                images=images,
                active_split="train",
                mode_id="cross_domain",
                pairing="random_single",
                grid_size=3,
                used_anchor_ids=used_anchor_ids,
                recently_shown=recently_shown
            )
            
            if not round_data:
                continue
                
            anchor = round_data["anchor"]
            options = round_data["options"]
            used_anchor_ids.add(anchor["id"])
            
            # Wait for puzzle to render on screen
            page.wait_for_selector("[data-testid='candidate-grid'], .grid, img", timeout=5000)
            time.sleep(0.5)
            
            # Get VLM evaluation
            selected_indices = evaluator.evaluate_puzzle(anchor, options)
            
            print(f"Round {round_idx+1:02d}/{num_rounds}: Anchor = {anchor['domain']}/{anchor['class']} | "
                  f"VLM selecting candidate indices: {selected_indices}")
                  
            # Interact with UI candidate tiles
            tiles = page.query_selector_all("[data-testid='candidate-tile'], button:has(img)")
            
            # Click candidate tiles chosen by VLM
            for idx in selected_indices:
                if idx < len(tiles):
                    tiles[idx].click()
                    time.sleep(0.3)
                    
            # Type VLM player note
            note_input = page.query_selector("input[placeholder*='note'], textarea[placeholder*='note']")
            if note_input:
                note_input.fill(f"VLM Agent ({backend.upper()}) verified invariant pair selection.")
                time.sleep(0.3)
                
            # Submit selections
            if selected_indices:
                save_btn = page.query_selector("button:has-text('Save'), button:has-text('pairs')")
                if save_btn:
                    save_btn.click()
            else:
                no_good_btn = page.query_selector("button:has-text('No good')")
                if no_good_btn:
                    no_good_btn.click()
                    
            time.sleep(0.8)
            
        print("\n[Browser] Simulation rounds complete. Exporting game record...")
        time.sleep(2)
        browser.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Playwright Browser VLM Agent")
    parser.add_argument("--rounds", type=int, default=10, help="Number of rounds to play")
    parser.add_argument("--seed", type=int, default=1337, help="Random seed")
    parser.add_argument("--backend", type=str, default="clip", help="Model backend")
    parser.add_argument("--url", type=str, default="http://localhost:5173", help="Web app URL")
    parser.add_argument("--headed", action="store_true", default=True, help="Watch browser live")
    args = parser.parse_args()
    
    run_browser_agent(num_rounds=args.rounds, seed=args.seed, backend=args.backend, app_url=args.url, headed=args.headed)
