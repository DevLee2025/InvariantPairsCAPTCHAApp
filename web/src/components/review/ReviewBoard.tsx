// Read-only board for Review mode: the recorded anchor + the numbered option grid
// (1..N²) with the player's selected position bordered in red (req 4). Mirrors the
// Play board's container-query square layout.

import type { PuzzleRecord } from "../../types";
import { RetryImg } from "../RetryImg";

interface Props {
  puzzle: PuzzleRecord;
  gridSize: number;
}

export function ReviewBoard({ puzzle, gridSize }: Props) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,340px)_1fr]">
      {/* Anchor + this puzzle's metadata */}
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
        <div
          className="flex min-h-0 flex-1 items-center justify-center"
          style={{ containerType: "size" }}
        >
          <div
            className="relative overflow-hidden rounded-xl border-2 border-accent bg-slate-50 shadow-sm"
            style={{ width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)" }}
          >
            <RetryImg
              src={puzzle.anchor.url}
              alt={`${puzzle.anchor.domain} · ${puzzle.anchor.class}`}
              className="h-full w-full object-cover"
              draggable={false}
            />
            <span className="absolute left-2 top-2 rounded bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
              anchor · {puzzle.anchor.domain} · {puzzle.anchor.class}
            </span>
          </div>
        </div>
        <div className="max-h-[42%] shrink-0 overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <div className="font-medium text-slate-800">
            {puzzle.selections.length > 0
              ? puzzle.selections.length === 1
                ? `Selected position ${puzzle.selections[0].position} · ${puzzle.selections[0].domain}·${puzzle.selections[0].class}`
                : `Selected positions ${puzzle.selections
                    .map((s) => s.position)
                    .join(", ")} · ${puzzle.selections.length} pairs`
              : "No good option (player rejected all)"}
          </div>
          <div className="mt-1 text-slate-500">
            {(puzzle.durationMs / 1000).toFixed(1)}s
            {puzzle.reviewFlag && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                flagged
              </span>
            )}
          </div>
          {puzzle.playerNote && (
            <div className="mt-1.5 italic text-slate-600">
              Player note: “{puzzle.playerNote}”
            </div>
          )}
        </div>
      </div>

      {/* Numbered option grid, selected one in red */}
      <div className="min-h-0 min-w-0">
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ containerType: "size" }}
        >
          <div
            className="grid gap-2"
            style={{
              width: "min(100cqw, 100cqh)",
              height: "min(100cqw, 100cqh)",
              gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`,
            }}
          >
            {puzzle.options.map((o) => {
              const isSel = puzzle.selections.some(
                (s) => s.position === o.position
              );
              return (
                <div
                  key={o.id}
                  className={`relative h-full w-full overflow-hidden rounded-lg border bg-slate-50 ${
                    isSel ? "border-red-500 ring-2 ring-red-500" : "border-slate-200"
                  }`}
                >
                  <RetryImg
                    src={o.url}
                    alt={`Position ${o.position}: ${o.domain} · ${o.class}`}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                  <span
                    className={`absolute left-1 top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1 text-[11px] font-semibold text-white ${
                      isSel ? "bg-red-600" : "bg-black/60"
                    }`}
                  >
                    {o.position}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
