// N×N candidate grid (req 6). The grid is a centered square sized to the smaller
// of its container's width/height (container queries), so tiles always fit — no
// overflow/overlap whether the saved drawer is open or closed.

import type { Img } from "../types";
import { CandidateTile } from "./CandidateTile";

interface Props {
  candidates: Img[];
  gridSize: number;
  selectedIds: ReadonlySet<string>; // multi-select: every toggled-on tile
  onToggle: (id: string) => void;
}

export function CandidateGrid({
  candidates,
  gridSize,
  selectedIds,
  onToggle,
}: Props) {
  return (
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
        {candidates.map((img, i) => (
          <CandidateTile
            key={img.id}
            img={img}
            position={i + 1}
            selected={selectedIds.has(img.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
