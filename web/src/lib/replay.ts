// Reproducibility check: re-run a saved game's seed against a manifest and verify
// the regenerated puzzle sequence matches what was recorded. This is the
// "seed verified" integrity check for peer review (req 4).

import type { GameRecord, Manifest, ModeId } from "../types";
import { makeRng } from "./random";
import { manifestHash } from "./manifest";
import { generateRound, RECENT_BUFFER } from "./round";
import { getMode } from "../modes";

export interface VerifyResult {
  status: "match" | "mismatch" | "unavailable";
  checkedPuzzles: number;
  totalPuzzles: number;
  mismatchAt?: number; // puzzleIndex of the first divergence
  reason?: string;
}

// Callers pass records normalized by lib/upgrade.upgradeGameRecord (always v3
// in memory). Selections play no part here — only anchors/options are replayed.
export function verifyGame(game: GameRecord, manifest: Manifest): VerifyResult {
  const total = game.puzzles.length;

  if (game.schemaVersion !== 3) {
    return {
      status: "unavailable",
      checkedPuzzles: 0,
      totalPuzzles: total,
      reason: "unsupported schema version",
    };
  }
  const liveHash = manifestHash(manifest);
  if (liveHash !== game.game.manifest.hash) {
    return {
      status: "unavailable",
      checkedPuzzles: 0,
      totalPuzzles: total,
      reason: `manifest mismatch (recorded ${game.game.manifest.hash}, current ${liveHash})`,
    };
  }

  const rng = makeRng(game.game.seed);
  const usedAnchorIds = new Set<string>();
  const recentlyShown: string[] = [];

  for (let k = 0; k < total; k++) {
    const rec = game.puzzles[k];
    const modeId: ModeId = rec.mode;
    const pairing = rec.domainPairing ?? game.game.domainPairing;

    const res = generateRound({
      rng,
      images: manifest.images,
      activeSplit: game.game.split,
      mode: getMode(modeId),
      pairing,
      gridSize: game.game.gridSize,
      usedAnchorIds,
      recentlyShown: new Set(recentlyShown),
    });

    if (!res) {
      return {
        status: "mismatch",
        checkedPuzzles: k,
        totalPuzzles: total,
        mismatchAt: rec.puzzleIndex,
        reason: "could not regenerate round",
      };
    }
    if (res.anchor.id !== rec.anchor.id) {
      return mismatch(k, rec.puzzleIndex, total, "anchor differs");
    }
    const gen = res.options.map((o) => o.id);
    const got = rec.options.map((o) => o.id);
    if (gen.length !== got.length || gen.some((id, i) => id !== got[i])) {
      return mismatch(k, rec.puzzleIndex, total, "options differ");
    }

    // Advance freshness exactly as the store does on a selection.
    usedAnchorIds.add(res.anchor.id);
    for (const o of res.options) recentlyShown.push(o.id);
    while (recentlyShown.length > RECENT_BUFFER) recentlyShown.shift();
  }

  return { status: "match", checkedPuzzles: total, totalPuzzles: total };
}

function mismatch(
  k: number,
  puzzleIndex: number,
  total: number,
  reason: string
): VerifyResult {
  return {
    status: "mismatch",
    checkedPuzzles: k,
    totalPuzzles: total,
    mismatchAt: puzzleIndex,
    reason,
  };
}
