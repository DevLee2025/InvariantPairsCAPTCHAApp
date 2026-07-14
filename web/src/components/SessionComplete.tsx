// Session-complete summary + export CTA (SPEC §6, §8). Shows timing stats (req 7).

import type { ModeId, PuzzleRecord, SessionConfig } from "../types";
import { getMode } from "../modes";

interface Props {
  open: boolean;
  session: SessionConfig;
  counts: Record<ModeId, number>;
  puzzles: PuzzleRecord[];
  screenshotCount: number;
  onExportJSON: () => void;
  onExportCSV: () => void;
  onExportScreenshots: () => void;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function SessionComplete({
  open,
  session,
  counts,
  puzzles,
  screenshotCount,
  onExportJSON,
  onExportCSV,
  onExportScreenshots,
}: Props) {
  if (!open) return null;
  const total = session.order.reduce((s, id) => s + counts[id], 0);
  const durations = puzzles.map((p) => p.durationMs);
  const avg =
    durations.length === 0
      ? 0
      : durations.reduce((a, b) => a + b, 0) / durations.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-800">Session complete</h2>
        <p className="mt-1 text-sm text-slate-600">
          You curated {total} invariant pairs. Export the game below.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-slate-50 p-2 text-center">
            <div className="text-[11px] text-slate-500">pairs</div>
            <div className="text-lg font-semibold tabular-nums text-slate-800">
              {total}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 text-center">
            <div className="text-[11px] text-slate-500">avg / puzzle</div>
            <div className="text-lg font-semibold tabular-nums text-slate-800">
              {(avg / 1000).toFixed(1)}s
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 text-center">
            <div className="text-[11px] text-slate-500">median</div>
            <div className="text-lg font-semibold tabular-nums text-slate-800">
              {(median(durations) / 1000).toFixed(1)}s
            </div>
          </div>
        </div>

        <ul className="mt-4 space-y-1.5">
          {session.order.map((id) => (
            <li
              key={id}
              className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm"
            >
              <span className="text-slate-700">{getMode(id).label}</span>
              <span className="tabular-nums text-slate-500">
                {counts[id]} / {session.perModeQuota[id]}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onExportScreenshots}
            disabled={screenshotCount === 0}
            className="mr-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Screenshots PDF ({screenshotCount})
          </button>
          <button
            type="button"
            onClick={onExportJSON}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={onExportCSV}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}
