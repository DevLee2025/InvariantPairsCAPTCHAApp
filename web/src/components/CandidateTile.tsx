// A single candidate image tile. Keyboard-selectable, lazy-loaded, accent ring on
// hover/selection. Shows its grid position number (1..N²) so notes/reviews can
// reference it ("image 7 vs your 3") (req 3).

import type { Img } from "../types";

interface Props {
  img: Img;
  position: number;
  selected?: boolean;
  onSelect: (id: string) => void;
}

export function CandidateTile({ img, position, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect(img.id)}
      className={`group relative h-full w-full overflow-hidden rounded-lg border bg-slate-50 outline-none transition focus-visible:ring-2 focus-visible:ring-accent ${
        selected
          ? "border-red-500 ring-2 ring-red-500"
          : "border-slate-200 hover:ring-2 hover:ring-accent"
      }`}
      aria-label={`Position ${position}: ${img.domain} · ${img.class}`}
      aria-pressed={selected}
    >
      <img
        src={img.url}
        alt={`${img.domain} · ${img.class}`}
        loading="lazy"
        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
        draggable={false}
      />
      <span className="pointer-events-none absolute left-1 top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-black/60 px-1 text-[11px] font-semibold text-white">
        {position}
      </span>
      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">
        {img.domain}
      </span>
    </button>
  );
}
