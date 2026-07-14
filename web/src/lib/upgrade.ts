// Single normalization point for saved game files. Accepts schema v2 (one
// selection per puzzle) or v3 (multi-select) and returns a v3 GameRecord, so
// every consumer — Review, resume, seed-verify, exports — handles ONE shape.
//
// v2 → v3 mapping per puzzle:
//   selections      = selected ? [{...selected, position: selectedPosition,
//                                  pickedAt: selectedAt}] : []
//   selectionScores = { [selected.id]: scores }  (when scores are non-empty)
// The legacy mirror fields (selected/selectedPosition/scores) are left as-is.

import type {
  GameRecord,
  PuzzleRecord,
  ReviewerAnnotation,
  SelectedOption,
} from "../types";

type Raw = Record<string, unknown>;

function upgradePuzzle(raw: Raw): PuzzleRecord {
  const p = raw as unknown as PuzzleRecord;

  if (Array.isArray((raw as Raw).selections)) {
    // Already v3 — just default the optional-in-JSON maps (toJSON omits them
    // when empty, same as the long-standing `scores` omission).
    return {
      ...p,
      selectionScores: p.selectionScores ?? {},
      scores: p.scores ?? {},
    };
  }

  const selections: SelectedOption[] = p.selected
    ? [
        {
          ...p.selected,
          position: p.selectedPosition,
          pickedAt: p.selectedAt,
        },
      ]
    : [];
  const scores = p.scores ?? {};
  const selectionScores =
    p.selected && Object.keys(scores).length > 0
      ? { [p.selected.id]: scores }
      : {};
  return { ...p, selections, selectionScores, scores };
}

// Validate + normalize a parsed saved-game JSON. Returns null when the value
// is not a schema v2/v3 game record.
export function upgradeGameRecord(raw: unknown): GameRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Raw;
  if (
    (g.schemaVersion !== 2 && g.schemaVersion !== 3) ||
    !g.game ||
    typeof g.game !== "object" ||
    !Array.isArray(g.puzzles)
  ) {
    return null;
  }
  return {
    ...(g as unknown as GameRecord),
    schemaVersion: 3,
    puzzles: (g.puzzles as Raw[]).map(upgradePuzzle),
    reviewerAnnotations: Array.isArray(g.reviewerAnnotations)
      ? (g.reviewerAnnotations as ReviewerAnnotation[])
      : [],
  };
}
