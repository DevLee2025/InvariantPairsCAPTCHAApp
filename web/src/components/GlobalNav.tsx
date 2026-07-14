// Slim global header with the Play / Review view switch.

import type { AppView } from "../state/store";

interface Props {
  view: AppView;
  onView: (v: AppView) => void;
}

export function GlobalNav({ view, onView }: Props) {
  const tab = (v: AppView, label: string) => (
    <button
      type="button"
      onClick={() => onView(v)}
      className={`rounded-md px-3 py-1 text-sm font-medium transition ${
        view === v
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-500 hover:text-slate-800"
      }`}
      aria-current={view === v}
    >
      {label}
    </button>
  );

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-slate-800">GRIT</span>
        <span className="text-xs text-slate-400">invariant pairs</span>
      </div>
      <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-0.5">
        {tab("play", "Play")}
        {tab("review", "Review")}
      </div>
    </header>
  );
}
