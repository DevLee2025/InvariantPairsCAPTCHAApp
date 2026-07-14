// Top bar: mode · pairing (disabled when locked) · grid size · preset · seed +
// New game · progress · Saved toggle (SPEC §6, §8; reqs 2, 6).

import type { DomainPair, ModeId, PresetName } from "../types";
import { DOMAIN_PAIRS, GRID_SIZES, pairingLabel } from "../types";
import { MODES, getMode } from "../modes";

interface Props {
  mode: ModeId;
  availableModes: ModeId[];
  domainPairing: DomainPair;
  preset: PresetName;
  gridSize: number;
  seed: number;
  seedInput: string;
  count: number;
  quota: number;
  savedCount: number;
  savedOpen: boolean;
  onModeChange: (m: ModeId) => void;
  onPairingChange: (p: DomainPair) => void;
  onPresetChange: (p: PresetName) => void;
  onGridSizeChange: (n: number) => void;
  onSeedInputChange: (s: string) => void;
  onNewGame: () => void;
  onLoadGame: () => void;
  onToggleSaved: () => void;
}

const selectCls =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800";

export function TopBar({
  mode,
  availableModes,
  domainPairing,
  preset,
  gridSize,
  seed,
  seedInput,
  count,
  quota,
  savedCount,
  savedOpen,
  onModeChange,
  onPairingChange,
  onPresetChange,
  onGridSizeChange,
  onSeedInputChange,
  onNewGame,
  onLoadGame,
  onToggleSaved,
}: Props) {
  const activeMode = getMode(mode);
  const locked = activeMode.lockedPairing != null;
  const pairingValue = activeMode.lockedPairing ?? domainPairing;

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Mode
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as ModeId)}
          className={selectCls}
        >
          {MODES.map((m) => {
            const avail = availableModes.includes(m.id);
            return (
              <option key={m.id} value={m.id} disabled={!avail}>
                {m.label}
                {avail ? "" : " (needs ML data)"}
              </option>
            );
          })}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Pairing
        <select
          value={pairingValue}
          disabled={locked}
          onChange={(e) => onPairingChange(e.target.value as DomainPair)}
          className={`${selectCls} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400`}
          title={locked ? "Locked by the active mode" : undefined}
        >
          {locked ? (
            <option value={pairingValue}>
              {pairingLabel(pairingValue)} (locked)
            </option>
          ) : (
            DOMAIN_PAIRS.map((p) => (
              <option key={p} value={p}>
                {pairingLabel(p)}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Grid
        <select
          value={gridSize}
          onChange={(e) => onGridSizeChange(Number(e.target.value))}
          className={selectCls}
        >
          {GRID_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}×{n}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Preset
        <select
          value={preset}
          onChange={(e) => onPresetChange(e.target.value as PresetName)}
          className={selectCls}
        >
          <option value="dev">dev</option>
          <option value="production">production</option>
        </select>
      </label>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span title={`active seed: ${seed}`} className="font-mono text-[11px] text-slate-400">
            seed {seed}
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={seedInput}
            onChange={(e) => onSeedInputChange(e.target.value)}
            placeholder="override"
            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
            aria-label="Seed override (blank = random)"
          />
          <button
            type="button"
            onClick={onNewGame}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            New game
          </button>
          <button
            type="button"
            onClick={onLoadGame}
            title="Load a saved game JSON and continue where it left off"
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Load game
          </button>
        </div>

        <div className="text-sm tabular-nums text-slate-600">
          <span className="font-semibold text-slate-800">{count}</span>
          <span className="text-slate-400"> / {quota}</span>
        </div>

        <button
          type="button"
          onClick={onToggleSaved}
          className={`rounded-md border px-3 py-1 text-sm font-medium transition ${
            savedOpen
              ? "border-accent bg-accent-soft text-accent"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Saved ({savedCount})
        </button>
      </div>
    </header>
  );
}
