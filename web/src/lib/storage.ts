// Persistence abstraction for completed puzzles. The in-memory implementation can
// be swapped for Supabase/Postgres or a HuggingFace push later (single-module
// change). Keyed by puzzleIndex within the current game.

import type { PuzzleRecord } from "../types";

export interface Storage {
  add(record: PuzzleRecord): void;
  update(puzzleIndex: number, patch: Partial<PuzzleRecord>): void;
  remove(puzzleIndex: number): void;
  clear(): void;
  all(): PuzzleRecord[];
  count(): number;
}

// In-memory implementation. State is lost on reload (intentional for this build).
export function createInMemoryStorage(): Storage {
  let records: PuzzleRecord[] = [];
  return {
    add(record) {
      records.push(record);
    },
    update(puzzleIndex, patch) {
      records = records.map((r) =>
        r.puzzleIndex === puzzleIndex ? { ...r, ...patch } : r
      );
    },
    remove(puzzleIndex) {
      records = records.filter((r) => r.puzzleIndex !== puzzleIndex);
    },
    clear() {
      records = [];
    },
    all() {
      return records.slice();
    },
    count() {
      return records.length;
    },
  };
}
