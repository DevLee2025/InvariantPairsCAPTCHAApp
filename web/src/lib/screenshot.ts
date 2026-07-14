// DOM screenshot capture for reproducibility insurance (req 5b). Uses html2canvas
// (a faithful DOM render, not an OS screenshot). Lazy-loaded so it doesn't bloat
// the initial bundle. Captured downscaled + JPEG to keep memory reasonable across
// long sessions (e.g. 250 puzzles).

export interface Screenshot {
  dataUrl: string; // image/jpeg data URI
  width: number;
  height: number;
}

// Hard cap so a stalled capture (e.g. the image server went down and html2canvas
// is waiting on images) can never freeze the round-advance — it resolves null and
// the game continues.
const CAPTURE_TIMEOUT_MS = 6000;

export async function captureElement(
  el: HTMLElement
): Promise<Screenshot | null> {
  try {
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await Promise.race([
      html2canvas(el, {
        scale: 0.6, // downscale to bound memory
        backgroundColor: "#f1f5f9",
        logging: false,
        useCORS: true,
        imageTimeout: 2500, // don't wait long on images that won't load
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("screenshot capture timed out")),
          CAPTURE_TIMEOUT_MS
        )
      ),
    ]);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.72),
      width: canvas.width,
      height: canvas.height,
    };
  } catch (e) {
    console.warn("screenshot capture failed", e);
    return null;
  }
}
