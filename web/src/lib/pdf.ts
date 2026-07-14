// PDF export of the ordered screenshots (req 5b). jsPDF is lazy-loaded.

import type { Screenshot } from "./screenshot";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// One screenshot per page, in capture order, each fit-to-page with a caption.
export async function exportScreenshotsPDF(shots: Screenshot[]): Promise<void> {
  if (shots.length === 0) return;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 28;
  const captionH = 16;

  shots.forEach((shot, i) => {
    if (i > 0) doc.addPage();
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Screenshot ${i + 1} of ${shots.length}`, margin, margin);

    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - captionH;
    const ratio = Math.min(availW / shot.width, availH / shot.height);
    const w = shot.width * ratio;
    const h = shot.height * ratio;
    const x = (pageW - w) / 2;
    const y = margin + captionH + (availH - h) / 2;
    doc.addImage(shot.dataUrl, "JPEG", x, y, w, h);
  });

  doc.save(`grit-screenshots-${stamp()}.pdf`);
}
