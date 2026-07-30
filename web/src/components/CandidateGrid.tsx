// N×N candidate grid (req 6). Responsive: On mobile (<1024px), scales to full
// width (max 500px) as an aspect-square box so candidate tiles are large and clear.
// On desktop (≥1024px), uses container query sizing to fit perfectly.

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
    <div className="flex h-full w-full items-center justify-center py-1">
      {/* Mobile Grid Layout (<1024px): Square aspect ratio with flex sizing */}
      <div className="w-full max-w-[500px] lg:hidden">
        <div
          className="grid aspect-square w-full gap-2"
          style={{
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

      {/* Desktop Grid Layout (≥1024px): Container query sizing */}
      <div
        className="hidden h-full w-full items-center justify-center lg:flex"
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
    </div>
  );
}
