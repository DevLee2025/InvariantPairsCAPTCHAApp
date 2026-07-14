// Mode registry (SPEC §5.3). The dropdown, strategy panel, and per-pair
// provenance all read from here. Adding a 4th mode = add one module + one entry
// in MODES below. No UI or plumbing changes required.

import type { Img, ManifestField, ModeId, SelectionMode } from "../types";
import { crossDomain } from "./crossDomain";
import { ermClip } from "./ermClip";
import { mixture } from "./mixture";

// Registration order is also the default session progression order (SPEC §6).
export const MODES: SelectionMode[] = [crossDomain, ermClip, mixture];

export const MODE_BY_ID: Record<ModeId, SelectionMode> = MODES.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<ModeId, SelectionMode>
);

export function getMode(id: ModeId): SelectionMode {
  return MODE_BY_ID[id];
}

export const MODE_ORDER: ModeId[] = MODES.map((m) => m.id);

// Is a given manifest field populated on a sample image? Used to decide whether
// a mode's requiredFields are satisfied (and thus whether to disable the mode).
function fieldPresent(img: Img, field: ManifestField): boolean {
  switch (field) {
    case "clipProbs":
      return Array.isArray(img.clipProbs) && img.clipProbs.length > 0;
    case "ermProbs":
      return Array.isArray(img.ermProbs) && img.ermProbs.length > 0;
    case "mix":
      return img.mix != null;
  }
}

// A mode is available if at least one image satisfies all its required fields.
export function modeAvailable(mode: SelectionMode, images: Img[]): boolean {
  if (mode.requiredFields.length === 0) return true;
  return images.some((img) =>
    mode.requiredFields.every((f) => fieldPresent(img, f))
  );
}
