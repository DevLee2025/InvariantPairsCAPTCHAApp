// Switch-mode modal shown at a quota boundary (SPEC §6).

import type { ModeId } from "../types";
import { getMode } from "../modes";

interface Props {
  open: boolean;
  fromMode: ModeId;
  toMode: ModeId | null;
  completedCount: number;
  onAccept: () => void;
  onDismiss: () => void;
}

export function SwitchPrompt({
  open,
  fromMode,
  toMode,
  completedCount,
  onAccept,
  onDismiss,
}: Props) {
  if (!open || !toMode) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-800">Quota reached</h2>
        <p className="mt-2 text-sm text-slate-600">
          You've completed {completedCount} {getMode(fromMode).label} pairs.
          Switch to {getMode(toMode).label}?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Stay
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Switch to {getMode(toMode).label}
          </button>
        </div>
      </div>
    </div>
  );
}
