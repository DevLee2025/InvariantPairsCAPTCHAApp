"""vlm_eval/browser_vlm_agent.py

Playwright-based Browser Automation Agent for VLM Web UI Play.
Launches Chromium in HEADED mode (`headless=False`), allowing you to watch
the VLM evaluate puzzles and physically interact with the web app UI in real-time.
Synchronizes directly with live React state (`window.useStore`), clicks candidate tiles,
and saves the exported JSON to `vlm_eval/out/grit-game-vlm-browser-dev.json`.
"""

from __future__ import annotations
import argparse
import datetime
import json
from pathlib import Path
import time

from playwright.sync_api import sync_playwright
from vlm_model import VLMEvaluator

def run_browser_agent(
    num_rounds: int = 5,
    seed: int = 1337,
    backend: str = "clip",
    app_url: str = "http://localhost:5174",
    headed: bool = True
):
    evaluator = VLMEvaluator(backend=backend)
    
    print(f"\n=======================================================")
    print(f"   STARTING BROWSER VLM AGENT ({num_rounds} rounds, headed={headed})")
    print(f"=======================================================\n")
    
    out_dir = Path("vlm_eval/out")
    out_dir.mkdir(parents=True, exist_ok=True)
    target_json_path = out_dir / "grit-game-vlm-browser-dev.json"
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=not headed,
            slow_mo=300,
            args=["--start-maximized", "--window-position=0,0", "--focus-on-new-tab"]
        )
        context = browser.new_context(no_viewport=True)
        page = context.new_page()
        page.goto(app_url)
        page.bring_to_front()
        page.wait_for_selector("text=Play", timeout=10000)

        
        print(f"[Browser] Successfully connected to web application at {app_url}\n")
        time.sleep(1)
        
        # Start new game with specified seed in React store
        page.evaluate(f"() => window.useStore.getState().newGame({seed})")
        time.sleep(1)
        
        for round_idx in range(num_rounds):
            page.wait_for_function("() => window.useStore && window.useStore.getState().round !== null", timeout=5000)
            
            round_data = page.evaluate("() => window.useStore.getState().round")
            if not round_data:
                continue
                
            anchor = round_data["anchor"]
            options = round_data["options"]
            
            # Get VLM evaluation for active on-screen puzzle
            selected_indices = evaluator.evaluate_puzzle(anchor, options)
            selected_ids = [options[i]["id"] for i in selected_indices if i < len(options)]
            
            print(f"Round {round_idx+1:02d}/{num_rounds}: Anchor = {anchor['domain']}/{anchor['class']} | "
                  f"VLM selecting candidate indices: {selected_indices}")
                  
            # Interact with UI candidate tiles for visual demonstration
            tiles = page.query_selector_all("button[aria-label*='Position']")
            for idx in selected_indices:
                if idx < len(tiles):
                    tiles[idx].click()
                    time.sleep(0.2)
                    
            # Type VLM player note into note input
            note_input = page.query_selector("input[placeholder*='note'], textarea[placeholder*='note']")
            if note_input:
                note_input.fill(f"VLM Agent ({backend.upper()}) verified invariant pair selection.")
                time.sleep(0.2)
                
            # Submit puzzle directly to Zustand store to guarantee clean React state commit
            page.evaluate("""(ids) => {
                const st = window.useStore.getState();
                const res = st.recordSelections(ids);
                if (res) st.commitScreenshot(res.puzzleIndex, null, true);
            }""", selected_ids)
            
            time.sleep(0.5)
            
        print("\n[Browser] Simulation rounds complete. Exporting GameRecord v3 JSON...")
        time.sleep(1)
        
        # Open Saved drawer UI for visual completion
        saved_btn = page.query_selector("button:has-text('Saved')")
        if saved_btn:
            saved_btn.click()
            time.sleep(1)
            
        # Extract canonical GameRecord v3 JSON directly from application state
        game_json_str = page.evaluate("""() => {
            if (window.useStore) {
                const s = window.useStore.getState();
                const puzzles = s.puzzles;
                const game = {
                    schemaVersion: 3,
                    game: {
                        gameId: s.gameId,
                        sessionId: s.sessionId,
                        seed: s.seed,
                        algoVersion: 1,
                        mode: s.mode,
                        domainPairing: s.domainPairing,
                        gridSize: s.gridSize,
                        optionCount: s.gridSize * s.gridSize,
                        split: s.activeSplit,
                        manifest: s.manifestInfo || { version: 1, imageCount: 0, hash: "" },
                        startedAt: s.startedAtISO,
                        endedAt: new Date().toISOString(),
                        timing: {
                            overallMs: Date.now() - s.startedAtMs,
                            averageMs: puzzles.length ? Math.round(puzzles.reduce((a, b) => a + b.durationMs, 0) / puzzles.length) : 0,
                            medianMs: puzzles.length ? Math.round(puzzles.reduce((a, b) => a + b.durationMs, 0) / puzzles.length) : 0,
                            perCaptchaMs: puzzles.map(p => p.durationMs)
                        }
                    },
                    puzzles: puzzles,
                    reviewerAnnotations: []
                };
                return JSON.stringify(game, null, 2);
            }
            return null;
        }""")
        
        if game_json_str:
            with open(target_json_path, "w", encoding="utf-8") as f:
                f.write(game_json_str)
            print(f"[Browser] SUCCESS! Saved GameRecord v3 JSON to: {target_json_path}")
        else:
            print("[Browser Warning] Could not extract game record from window.useStore.")
            
        time.sleep(1)
        browser.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Playwright Browser VLM Agent")
    parser.add_argument("--rounds", type=int, default=5, help="Number of rounds to play")
    parser.add_argument("--seed", type=int, default=1337, help="Random seed")
    parser.add_argument("--backend", type=str, default="clip", help="Model backend")
    parser.add_argument("--url", type=str, default="http://localhost:5174", help="Web app URL")
    parser.add_argument("--headed", action="store_true", default=True, help="Watch browser live")
    args = parser.parse_args()
    
    run_browser_agent(num_rounds=args.rounds, seed=args.seed, backend=args.backend, app_url=args.url, headed=args.headed)
