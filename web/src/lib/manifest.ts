// Loads the static manifest once, resolves each image's display URL, and exposes
// a content fingerprint used to pin the dataset for replay (SPEC §4).

import type { Img, Manifest } from "../types";

// Real PACS manifest (written by pipeline/build_real_manifest.py). If it's not
// present yet, we fall back to the committed synthetic dev manifest.
export const MANIFEST_URL = "/manifest.json";
export const FALLBACK_MANIFEST_URL = "/manifest.sample.json";

type RawImg = Omit<Img, "url">;
interface RawManifest extends Omit<Manifest, "images"> {
  images: RawImg[];
}

// Domain-keyed colors for the offline dev placeholder.
const PH_BG: Record<string, string> = {
  photo: "#dbeafe",
  art_painting: "#fde8d3",
  cartoon: "#ede9fe",
  sketch: "#e2e8f0",
};
const PH_FG: Record<string, string> = {
  photo: "#1d4ed8",
  art_painting: "#c2410c",
  cartoon: "#6d28d9",
  sketch: "#334155",
};

// A deterministic, OFFLINE SVG data-URI placeholder: domain-colored tile labeled
// with class · domain · stem. Renders with no network (real PACS isn't hosted
// yet) and is same-origin/inline so html2canvas (Phase B) can capture it.
function placeholderUrl(img: RawImg): string {
  const bg = PH_BG[img.domain] ?? "#eef2f7";
  const fg = PH_FG[img.domain] ?? "#334155";
  const stem = img.id.split("/").pop() ?? "";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>` +
    `<rect width='256' height='256' fill='${bg}'/>` +
    `<text x='128' y='120' font-family='sans-serif' font-size='30' font-weight='600' fill='${fg}' text-anchor='middle'>${img.class}</text>` +
    `<text x='128' y='152' font-family='sans-serif' font-size='17' fill='${fg}' text-anchor='middle' opacity='0.85'>${img.domain}</text>` +
    `<text x='128' y='180' font-family='monospace' font-size='13' fill='${fg}' text-anchor='middle' opacity='0.6'>#${stem}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Resolve the display URL for an image.
//   cdnBase set → `${cdnBase}/${file}` (real CDN later).
//   cdnBase ""  → offline SVG data-URI placeholder (synthetic dev data).
export function resolveUrl(cdnBase: string, img: RawImg): string {
  if (cdnBase && cdnBase.length > 0) {
    return `${cdnBase}/${img.file}`;
  }
  return placeholderUrl(img);
}

async function tryFetch(url: string): Promise<RawManifest | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as RawManifest;
  } catch {
    return null;
  }
}

export async function loadManifest(url?: string): Promise<Manifest> {
  // Explicit url → use it; otherwise prefer the real manifest, fall back to the
  // synthetic dev one if PACS hasn't been built yet.
  let raw = await tryFetch(url ?? MANIFEST_URL);
  if (!raw && !url) raw = await tryFetch(FALLBACK_MANIFEST_URL);
  if (!raw) {
    throw new Error(`Failed to load a manifest (${url ?? MANIFEST_URL})`);
  }
  const images: Img[] = raw.images.map((img) => ({
    ...img,
    url: resolveUrl(raw!.cdnBase, img),
  }));
  return { ...raw, images };
}

// FNV-1a 32-bit fingerprint over version + ordered image ids. A cheap content
// hash to pin the dataset: replaying a saved game against a manifest with a
// different hash means the seed will NOT reproduce the recorded puzzles.
export function manifestHash(m: Manifest): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  feed(`v${m.version};`);
  for (const img of m.images) feed(`${img.id};`);
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
