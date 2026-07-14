// Review / Annotation mode (Phase C, req 4). Loads a saved game JSON, steps
// through puzzles (numbered grid, red-bordered pick, player note), lets the
// reviewer add per-puzzle comments, runs the seed reproducibility check, and
// exports an annotation PDF / annotated JSON.

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useReviewStore } from "../../state/reviewStore";
import { CLASSES, DOMAINS, type ClassName, type Domain } from "../../types";
import { downloadFile, exportGameJSON, stamp } from "../../lib/export";
import { exportAnnotationPDF } from "../../lib/reviewPdf";
import { upgradeGameRecord } from "../../lib/upgrade";
import { apiGetExport } from "../../lib/api";
import { ReviewBoard } from "./ReviewBoard";

const chip =
  "rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600";

function s(n: number | null): string {
  return ((n ?? 0) / 1000).toFixed(1);
}

export function ReviewView() {
  const r = useReviewStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [joinCode, setJoinCode] = useState("");
  const [nameInput, setNameInput] = useState(r.username);

  // Warm the image cache for the current + adjacent puzzles so scrubbing is smooth.
  useEffect(() => {
    const game = r.game;
    if (!game) return;
    const idxs = [r.index - 1, r.index, r.index + 1].filter(
      (i) => i >= 0 && i < game.puzzles.length
    );
    for (const i of idxs) {
      const p = game.puzzles[i];
      for (const u of [p.anchor.url, ...p.options.map((o) => o.url)]) {
        const im = new Image();
        im.src = u;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.index, r.game]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => r.load(t, f.name));
    e.target.value = ""; // allow re-loading the same file
  };

  const hiddenInput = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      onChange={onFile}
      className="hidden"
    />
  );

  if (!r.game) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {hiddenInput}
        <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800">
              Review a saved game
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Load a game JSON exported from Play to review the choices, add
              comments, and verify reproducibility.
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Load game JSON
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800">
              Join with a code
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter a share code from another annotator. You review blind —
              selections and other comments stay hidden until you reveal them.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your annotator name"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                aria-label="Annotator name"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  maxLength={6}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-center font-mono text-sm uppercase tracking-widest text-slate-800"
                  aria-label="Share code"
                />
                <button
                  type="button"
                  disabled={r.netBusy || joinCode.trim().length < 6 || !nameInput.trim()}
                  onClick={() => r.joinByCode(joinCode, nameInput)}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  {r.netBusy ? "Joining…" : "Join"}
                </button>
              </div>
            </div>
          </div>

          {r.error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 md:col-span-2">
              {r.error}
            </p>
          )}
        </div>
      </div>
    );
  }

  const g = r.game.game;
  const puzzle = r.game.puzzles[r.index];
  const total = r.game.puzzles.length;
  const v = r.verify;
  const shared = r.source === "shared";
  const blind = shared && !!puzzle && !r.revealed[puzzle.puzzleIndex];
  const leakTitle = shared
    ? "Disabled in shared mode — this filter would leak the player's responses"
    : undefined;

  const onShare = () => {
    const name =
      window.prompt(
        "Annotator name (used to attribute your comments):",
        r.username || ""
      ) ?? "";
    if (name.trim()) void r.shareGame(name);
  };

  // Shared mode exports use the server's merged record (all annotators).
  const onAnnotationPDF = async () => {
    if (shared && r.shareCode) {
      const merged = upgradeGameRecord(await apiGetExport(r.shareCode));
      if (merged) await exportAnnotationPDF(merged, merged.reviewerAnnotations);
    } else if (r.game) {
      await exportAnnotationPDF(
        r.game,
        r.annotatedGame()?.reviewerAnnotations ?? []
      );
    }
  };
  const onSaveJSON = async () => {
    if (shared && r.shareCode) {
      const raw = await apiGetExport(r.shareCode);
      downloadFile(
        `grit-shared-annotations-${r.shareCode}-${stamp()}.json`,
        JSON.stringify(raw, null, 2),
        "application/json"
      );
    } else {
      const annotated = r.annotatedGame();
      if (annotated) exportGameJSON(annotated);
    }
  };
  // Filtering.
  const filtered = r.getFiltered();
  const filteredCount = filtered.length;
  const pos = filtered.indexOf(r.index); // 0-based position within the filtered set
  const boundMinS = r.durationBounds.minMs / 1000;
  const boundMaxS = r.durationBounds.maxMs / 1000;
  const curMinS = r.filters.minMs / 1000;
  const curMaxS = r.filters.maxMs / 1000;
  const setMin = (sec: number) => r.setFilters({ minMs: Math.round(sec * 1000) });
  const setMax = (sec: number) => r.setFilters({ maxMs: Math.round(sec * 1000) });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hiddenInput}

      {/* Header: file · meta · verify · exports */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Load game…
        </button>
        {r.fileName && (
          <span className="max-w-[180px] truncate text-xs text-slate-400">
            {r.fileName}
          </span>
        )}
        {shared && r.shareCode ? (
          <>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(r.shareCode!)}
              title="Share code — click to copy. Other annotators join Review with it."
              className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-accent"
            >
              code {r.shareCode}
            </button>
            <span className={chip}>annotator {r.username}</span>
          </>
        ) : (
          <button
            type="button"
            onClick={onShare}
            disabled={r.netBusy}
            title="Upload this game to the annotation server and get a share code for other annotators"
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Share for annotators…
          </button>
        )}
        <span className={chip}>seed {g.seed}</span>
        <span className={chip}>
          grid {g.gridSize}×{g.gridSize}
        </span>
        <span className={chip}>{g.mode}</span>
        <span className={chip}>split {g.split}</span>
        <span className={chip}>overall {s(g.timing.overallMs)}s</span>
        <span className={chip}>median {s(g.timing.medianMs)}s</span>

        {/* Seed-verify */}
        <div className="ml-auto flex items-center gap-2">
          {v == null ? (
            <button
              type="button"
              onClick={r.runVerify}
              disabled={r.verifying}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {r.verifying ? "Checking…" : "Verify seed"}
            </button>
          ) : v.status === "match" ? (
            <span className="rounded-md bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
              ✓ seed verified ({v.checkedPuzzles}/{v.totalPuzzles})
            </span>
          ) : v.status === "mismatch" ? (
            <span
              title={v.reason}
              className="rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700"
            >
              ✗ mismatch at puzzle {v.mismatchAt}
            </span>
          ) : (
            <span
              title={v.reason}
              className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500"
            >
              — can’t verify
            </span>
          )}

          {!shared && (
            <button
              type="button"
              onClick={r.chooseAnnotationFile}
              title="Pick a file that annotations auto-save to on every submit (crash-safe)"
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                r.annotationFile
                  ? "border-green-300 bg-green-50 text-green-700"
                  : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
            >
              {r.annotationFile
                ? `Auto-save: ${r.annotationFile.name}`
                : "Enable auto-save"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void onAnnotationPDF()}
            title={shared ? "Includes every annotator's comments" : undefined}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Annotation PDF
          </button>
          <button
            type="button"
            onClick={() => void onSaveJSON()}
            title={shared ? "Downloads the merged record (all annotators)" : undefined}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Save annotated JSON
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-500">Filter (all apply):</span>
        <label
          className={`flex items-center gap-1.5 ${shared ? "opacity-40" : ""}`}
          title={leakTitle}
        >
          <input
            type="checkbox"
            checked={r.filters.noGood}
            disabled={shared}
            onChange={(e) => r.setFilters({ noGood: e.target.checked })}
            className="h-3.5 w-3.5 accent-slate-600"
          />
          “No good option”
        </label>
        <label
          className={`flex items-center gap-1.5 ${shared ? "opacity-40" : ""}`}
          title={leakTitle}
        >
          <input
            type="checkbox"
            checked={r.filters.flagged}
            disabled={shared}
            onChange={(e) => r.setFilters({ flagged: e.target.checked })}
            className="h-3.5 w-3.5 accent-slate-600"
          />
          Flagged for review
        </label>
        <label
          className={`flex items-center gap-1.5 ${shared ? "opacity-40" : ""}`}
          title={leakTitle}
        >
          <input
            type="checkbox"
            checked={r.filters.commented}
            disabled={shared}
            onChange={(e) => r.setFilters({ commented: e.target.checked })}
            className="h-3.5 w-3.5 accent-slate-600"
          />
          Player commented
        </label>
        <span className="h-4 w-px bg-slate-300" />
        <select
          value={r.filters.klass}
          onChange={(e) =>
            r.setFilters({ klass: e.target.value as ClassName | "" })
          }
          className="rounded border border-slate-300 bg-white px-1 py-0.5"
          aria-label="Class filter"
        >
          <option value="">any class</option>
          {CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={r.filters.anchorDomain}
          onChange={(e) =>
            r.setFilters({ anchorDomain: e.target.value as Domain | "" })
          }
          className="rounded border border-slate-300 bg-white px-1 py-0.5"
          aria-label="Anchor domain filter"
        >
          <option value="">any anchor domain</option>
          {DOMAINS.map((d) => (
            <option key={d} value={d}>
              anchor: {d}
            </option>
          ))}
        </select>
        <select
          value={r.filters.selectedDomain}
          disabled={shared}
          title={leakTitle}
          onChange={(e) =>
            r.setFilters({ selectedDomain: e.target.value as Domain | "" })
          }
          className="rounded border border-slate-300 bg-white px-1 py-0.5 disabled:opacity-40"
          aria-label="Selected image domain filter"
        >
          <option value="">any selected domain</option>
          {DOMAINS.map((d) => (
            <option key={d} value={d}>
              selected: {d}
            </option>
          ))}
        </select>
        <span className="h-4 w-px bg-slate-300" />
        <span className="font-medium text-slate-500">Choice time (s):</span>
        <input
          type="number"
          step={0.1}
          min={boundMinS}
          max={boundMaxS}
          value={curMinS}
          onChange={(e) => setMin(Number(e.target.value))}
          className="w-16 rounded border border-slate-300 px-1 py-0.5"
          aria-label="Min choice time (seconds)"
        />
        <input
          type="range"
          step={0.1}
          min={boundMinS}
          max={boundMaxS}
          value={curMinS}
          onChange={(e) => setMin(Number(e.target.value))}
          className="w-24 accent-slate-500"
          aria-label="Min choice time slider"
        />
        <span className="text-slate-400">to</span>
        <input
          type="range"
          step={0.1}
          min={boundMinS}
          max={boundMaxS}
          value={curMaxS}
          onChange={(e) => setMax(Number(e.target.value))}
          className="w-24 accent-slate-500"
          aria-label="Max choice time slider"
        />
        <input
          type="number"
          step={0.1}
          min={boundMinS}
          max={boundMaxS}
          value={curMaxS}
          onChange={(e) => setMax(Number(e.target.value))}
          className="w-16 rounded border border-slate-300 px-1 py-0.5"
          aria-label="Max choice time (seconds)"
        />
        <span className="ml-auto font-medium text-slate-500">
          {filteredCount} of {total} shown
        </span>
      </div>

      {/* Nav */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-1.5">
        <button
          type="button"
          onClick={r.prev}
          disabled={pos <= 0}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          aria-label="Previous puzzle"
        >
          ‹
        </button>
        <span className="text-sm font-medium tabular-nums text-slate-700">
          {filteredCount > 0 ? `${pos + 1} / ${filteredCount}` : "0 / 0"}
          <span className="ml-2 font-normal text-slate-400">
            · puzzle #{puzzle.puzzleIndex} of {total}
          </span>
        </span>
        <button
          type="button"
          onClick={r.next}
          disabled={pos < 0 || pos >= filteredCount - 1}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          aria-label="Next puzzle"
        >
          ›
        </button>
        <input
          type="range"
          min={1}
          max={Math.max(1, filteredCount)}
          value={pos >= 0 ? pos + 1 : 1}
          disabled={filteredCount <= 1}
          onChange={(e) => r.setIndex(filtered[Number(e.target.value) - 1])}
          className="ml-2 w-48 accent-slate-500"
          aria-label="Jump to puzzle"
        />
      </div>

      {/* Board + reviewer comment */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        {filteredCount === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-slate-400">
            No puzzles match the current filters — loosen a filter above.
          </div>
        ) : (
          <>
            <ReviewBoard puzzle={puzzle} gridSize={g.gridSize} blind={blind} />
            <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] font-medium text-slate-500">
              Reviewer comment · puzzle {puzzle.puzzleIndex}
            </label>
            {r.autoSaveMsg && (
              <span className="truncate text-[11px] text-slate-400">
                {r.autoSaveMsg}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-start gap-2">
            <textarea
              value={r.annotations[puzzle.puzzleIndex] ?? ""}
              onChange={(e) =>
                r.setAnnotation(puzzle.puzzleIndex, e.target.value)
              }
              placeholder="e.g. “image 7 matches the anchor better than your pick (3)”"
              rows={2}
              className="min-w-0 flex-1 resize-none rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
            />
            <button
              type="button"
              onClick={() => r.submitComment(puzzle.puzzleIndex)}
              className="shrink-0 self-stretch rounded-md bg-accent px-3 text-sm font-medium text-white hover:opacity-90"
            >
              Submit
              <br />
              comment
            </button>
          </div>
            </div>

            {shared && (
              <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2">
                {blind ? (
                  <button
                    type="button"
                    onClick={() => void r.reveal(puzzle.puzzleIndex)}
                    title="Permanently reveals this puzzle's responses for you (recorded with a timestamp)"
                    className="w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                  >
                    🙈 Show responses — the player’s selection and other annotators’ comments
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-slate-500">
                        Other annotators · revealed{" "}
                        {new Date(
                          r.revealed[puzzle.puzzleIndex]
                        ).toLocaleTimeString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => void r.refreshOthers()}
                        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                      >
                        Refresh
                      </button>
                    </div>
                    {(r.others[puzzle.puzzleIndex] ?? []).length === 0 ? (
                      <p className="mt-1 text-xs text-slate-400">
                        No comments from other annotators yet.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {(r.others[puzzle.puzzleIndex] ?? []).map((o) => (
                          <li key={o.annotator} className="text-xs text-slate-700">
                            <span className="font-semibold">{o.annotator}</span>
                            {o.revealedAt === null && (
                              <span
                                className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500"
                                title="Written before this annotator revealed the responses"
                              >
                                blind
                              </span>
                            )}
                            <span className="ml-1.5">{o.comment}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
