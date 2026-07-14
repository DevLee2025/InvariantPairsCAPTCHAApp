// Play view: the game board, note bar, saved drawer, and modals (SPEC §8; reqs
// 2, 3, 5a, 5b, 6, 7). Extracted from App so App can switch Play ↔ Review.

import { useRef, useState, type ChangeEvent } from "react";
import { useStore } from "../state/store";
import { getMode } from "../modes";
import { captureElement } from "../lib/screenshot";
import { exportScreenshotsPDF } from "../lib/pdf";
import type { GameRecord } from "../types";
import { TopBar } from "./TopBar";
import { AnchorPanel } from "./AnchorPanel";
import { CandidateGrid } from "./CandidateGrid";
import { SavedPanel } from "./SavedPanel";
import { SwitchPrompt } from "./SwitchPrompt";
import { SessionComplete } from "./SessionComplete";

export function PlayView() {
  const s = useStore();
  const boardRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<HTMLInputElement>(null);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);

  const quota = s.session.perModeQuota[s.mode];
  const params = { ...(getMode(s.mode).defaultParams ?? {}) };
  const optionCount = s.gridSize * s.gridSize;
  const pendingCount = s.pendingSelections.length;
  const selectedIds = new Set(s.pendingSelections);

  // Submit the current picks ([] via "No good options"), capture the answered
  // board (all picked tiles are ringed), then advance.
  const submit = async (ids: string[]) => {
    const st = useStore.getState();
    if (st.capturing || !st.round) return;
    const res = st.recordSelections(ids);
    if (!res) return;
    // Let the selection rings paint before capturing — but rAF is throttled to
    // ZERO in a backgrounded tab, so never hang on it (150 ms fallback).
    await new Promise<void>((resolve) => {
      const t = window.setTimeout(resolve, 150);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.clearTimeout(t);
          resolve();
        })
      );
    });
    const el = boardRef.current;
    const shot = el ? await captureElement(el) : null;
    useStore.getState().commitScreenshot(res.puzzleIndex, shot, res.shouldAdvance);
  };

  const onExportScreenshots = () => exportScreenshotsPDF(s.screenshots);

  const handleLoadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const game = JSON.parse(await f.text()) as GameRecord;
      const res = useStore.getState().resumeGame(game);
      setLoadMsg(
        res.ok
          ? `Resumed ${res.resumed} pairs from ${f.name} — continue playing.`
          : `Couldn't resume: ${res.error}`
      );
    } catch (err) {
      setLoadMsg(`Could not read file: ${(err as Error).message}`);
    }
    window.setTimeout(() => setLoadMsg(null), 7000);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input
        ref={loadRef}
        type="file"
        accept="application/json,.json"
        onChange={handleLoadFile}
        className="hidden"
      />
      <TopBar
        mode={s.mode}
        availableModes={s.availableModes}
        domainPairing={s.domainPairing}
        preset={s.preset}
        gridSize={s.gridSize}
        seed={s.seed}
        seedInput={s.seedInput}
        count={s.counts[s.mode]}
        quota={quota}
        savedCount={s.puzzles.length}
        savedOpen={s.savedOpen}
        onModeChange={s.setMode}
        onPairingChange={s.setDomainPairing}
        onPresetChange={s.setPreset}
        onGridSizeChange={s.setGridSize}
        onSeedInputChange={s.setSeedInput}
        onNewGame={() => s.newGame()}
        onLoadGame={() => loadRef.current?.click()}
        onToggleSaved={s.toggleSaved}
      />

      {loadMsg && (
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs text-slate-700">
          {loadMsg}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-hidden p-4">
          {s.loading ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              Loading manifest…
            </div>
          ) : s.error ? (
            <div className="flex h-full items-center justify-center text-red-500">
              {s.error}
            </div>
          ) : (
            <div
              ref={boardRef}
              aria-busy={s.capturing}
              className="flex h-full min-h-0 flex-col gap-3"
            >
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,340px)_1fr]">
                <AnchorPanel
                  anchor={s.round?.anchor ?? null}
                  mode={s.mode}
                  poolSize={s.round?.poolSize ?? 0}
                  optionCount={optionCount}
                  params={params}
                  domainPairing={s.domainPairing}
                  partnerDomain={s.round?.partnerDomain ?? null}
                />
                <div className="min-h-0 min-w-0">
                  {s.round ? (
                    <CandidateGrid
                      candidates={s.round.options}
                      gridSize={s.gridSize}
                      selectedIds={selectedIds}
                      onToggle={s.toggleSelection}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">
                      No candidates available.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={s.currentFlag}
                    onChange={s.toggleCurrentFlag}
                    className="h-4 w-4 accent-amber-500"
                  />
                  Flag for review
                </label>
                <input
                  type="text"
                  value={s.currentNote}
                  onChange={(e) => s.setCurrentNote(e.target.value)}
                  placeholder="Optional note for this puzzle (e.g. “torn between 3 and 7”)…"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => submit([])}
                  disabled={s.capturing || !s.round || pendingCount > 0}
                  title={
                    pendingCount > 0
                      ? "You have picks selected — deselect them first if none are good"
                      : "None of the options are a good match for the anchor"
                  }
                  className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                >
                  No good options
                </button>
                <button
                  type="button"
                  onClick={() => submit(useStore.getState().pendingSelections)}
                  disabled={s.capturing || !s.round || pendingCount === 0}
                  title="Save every selected option as an invariant pair with the anchor"
                  className="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  Save {pendingCount} pair{pendingCount === 1 ? "" : "s"}
                </button>
                <span className="hidden shrink-0 text-[11px] text-slate-400 lg:inline">
                  {s.capturing
                    ? "Saving…"
                    : pendingCount === 0
                      ? "click options to select"
                      : "note saved with these picks"}
                </span>
              </div>
            </div>
          )}
        </main>

        <SavedPanel
          open={s.savedOpen}
          puzzles={s.puzzles}
          screenshotCount={s.screenshots.length}
          onClose={s.toggleSaved}
          onRemove={s.removePuzzle}
          onClear={s.clearPuzzles}
          onExportJSON={s.exportJSON}
          onExportCSV={s.exportCSV}
          onExportScreenshots={onExportScreenshots}
        />
      </div>

      <SwitchPrompt
        open={s.showSwitchPrompt}
        fromMode={s.mode}
        toMode={s.switchTo}
        completedCount={s.counts[s.mode]}
        onAccept={s.acceptSwitchPrompt}
        onDismiss={s.dismissSwitchPrompt}
      />

      <SessionComplete
        open={s.sessionComplete}
        session={s.session}
        counts={s.counts}
        puzzles={s.puzzles}
        screenshotCount={s.screenshots.length}
        onExportJSON={s.exportJSON}
        onExportCSV={s.exportCSV}
        onExportScreenshots={onExportScreenshots}
      />
    </div>
  );
}
