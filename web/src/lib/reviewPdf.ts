// Annotation report PDF (req 4): ONE PAGE PER PUZZLE showing the anchor and the
// FULL numbered option grid (player's picks boxed red), plus the player note/flag
// and every reviewer's comment (attributed; "[blind]" = written before that
// annotator revealed the responses) — so mentors can see every choice the
// player had and how independent reviewers judged it.
//
// Images are pre-rasterized in parallel (timeout + placeholder) so the PDF never
// silently comes out blank if some loads are slow.

import type { GameRecord, ReviewerAnnotation } from "../types";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// Load `url` and return a square JPEG data-URI (center-cropped), or null on
// failure/timeout. Works for same-origin /pacs images and (with CORS) CDN images.
function rasterize(url: string, px: number, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = px;
        c.height = px;
        const ctx = c.getContext("2d");
        if (!ctx) return finish(null);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, px, px);
        const s = Math.min(img.naturalWidth, img.naturalHeight) || 1;
        const sx = (img.naturalWidth - s) / 2;
        const sy = (img.naturalHeight - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, px, px);
        finish(c.toDataURL("image/jpeg", 0.8));
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = url;
  });
}

// Rasterize all unique urls in parallel (capped), filling `cache`.
async function rasterizeAll(
  urls: string[],
  px: number,
  cache: Map<string, string | null>
): Promise<void> {
  const todo = [...new Set(urls)].filter((u) => !cache.has(u));
  const CONCURRENCY = 8;
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const u = todo[i++];
      cache.set(u, await rasterize(u, px));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker)
  );
}

export async function exportAnnotationPDF(
  game: GameRecord,
  annotations: ReviewerAnnotation[]
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const g = game.game;

  // Group attributed comments per puzzle.
  const byPuzzle = new Map<number, ReviewerAnnotation[]>();
  for (const a of annotations) {
    if (!a.comment.trim()) continue;
    const list = byPuzzle.get(a.puzzleIndex) ?? [];
    list.push(a);
    byPuzzle.set(a.puzzleIndex, list);
  }

  // Pre-rasterize anchor + every option for every puzzle.
  const cache = new Map<string, string | null>();
  const urls: string[] = [];
  for (const p of game.puzzles) {
    urls.push(p.anchor.url);
    for (const o of p.options) urls.push(o.url);
  }
  await rasterizeAll(urls, 128, cache);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 32;
  const n = g.gridSize;

  const placeholder = (x: number, y: number, w: number, h: number) => {
    doc.setFillColor(241, 245, 249);
    doc.rect(x, y, w, h, "F");
  };

  game.puzzles.forEach((p, idx) => {
    if (idx > 0) doc.addPage();
    let y = margin;

    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text(`Puzzle ${p.puzzleIndex} of ${game.puzzles.length}`, margin, y);
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      `seed ${g.seed} · grid ${n}×${n} · ${p.mode} · ${(p.durationMs / 1000).toFixed(1)}s${p.reviewFlag ? " · FLAGGED" : ""}`,
      margin,
      y + 14
    );
    y += 30;

    // Anchor (left).
    const aSize = 120;
    const at = cache.get(p.anchor.url) ?? null;
    if (at) doc.addImage(at, "JPEG", margin, y, aSize, aSize);
    else placeholder(margin, y, aSize, aSize);
    doc.setDrawColor(80, 120, 220);
    doc.setLineWidth(1.5);
    doc.rect(margin, y, aSize, aSize);
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(`anchor · ${p.anchor.domain}·${p.anchor.class}`, margin, y + aSize + 12);

    // Option grid (right of anchor).
    const gx = margin + aSize + 24;
    const gw = pageW - margin - gx;
    const gap = 6;
    const cell = Math.min((gw - (n - 1) * gap) / n, 72);

    const selectedPositions = new Set(p.selections.map((s) => s.position));
    p.options.forEach((o, i) => {
      const r = Math.floor(i / n);
      const c = i % n;
      const ox = gx + c * (cell + gap);
      const oy = y + r * (cell + gap);
      const t = cache.get(o.url) ?? null;
      if (t) doc.addImage(t, "JPEG", ox, oy, cell, cell);
      else placeholder(ox, oy, cell, cell);

      const sel = selectedPositions.has(o.position);
      if (sel) {
        doc.setDrawColor(220, 40, 40);
        doc.setLineWidth(2);
      } else {
        doc.setDrawColor(205);
        doc.setLineWidth(0.5);
      }
      doc.rect(ox, oy, cell, cell);

      // position badge
      doc.setFillColor(sel ? 220 : 20, sel ? 40 : 20, sel ? 40 : 20);
      doc.rect(ox + 1, oy + 1, 13, 10, "F");
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.text(String(o.position), ox + 3.5, oy + 8.5);
    });

    const gridBottom = y + n * cell + (n - 1) * gap;
    let ty = Math.max(y + aSize + 24, gridBottom + 18);

    doc.setFontSize(9);
    doc.setTextColor(20);
    doc.text(
      p.selections.length > 0
        ? p.selections.length === 1
          ? `Selected: position ${p.selections[0].position} · ${p.selections[0].domain}·${p.selections[0].class}`
          : `Selected: positions ${p.selections
              .map((s) => s.position)
              .join(", ")} (${p.selections.length} pairs, pick order)`
        : "Selected: none — player marked 'no good options'",
      margin,
      ty
    );
    ty += 15;
    doc.setTextColor(60);
    doc.text(
      doc.splitTextToSize(`Player note: ${p.playerNote || "—"}`, pageW - 2 * margin),
      margin,
      ty
    );
    ty += 18;
    doc.setTextColor(20);
    const anns = byPuzzle.get(p.puzzleIndex) ?? [];
    const reviewerLines =
      anns.length === 0
        ? ["Reviewer: —"]
        : anns.map(
            (a) =>
              `Reviewer${a.annotator ? ` (${a.annotator})` : ""}${
                a.revealedAt === null ? " [blind]" : ""
              }: ${a.comment}`
          );
    for (const line of reviewerLines) {
      const wrapped = doc.splitTextToSize(line, pageW - 2 * margin) as string[];
      doc.text(wrapped, margin, ty);
      ty += wrapped.length * 11 + 4;
    }
  });

  doc.save(`grit-annotations-${stamp()}.pdf`);
}
