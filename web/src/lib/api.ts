// Client for the multi-annotator Review API (server/app.py), reached through
// Vite's /api proxy — same origin, so LAN annotators only need the Vite URL.

import type { GameRecord } from "../types";

// One annotator's server-side record. Keys are puzzleIndex as strings.
export interface OwnCommentEntry {
  comment: string;
  at: string;
  revealedAt: string | null;
}
export type OwnComments = Record<string, OwnCommentEntry>;

export interface AnnotatorRecord {
  username: string;
  comments: OwnComments;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new Error(
      "Annotation server unreachable — is it running? (npm run api)"
    );
  }
  if (!res.ok) {
    let detail = `request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // keep the status-based message
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function apiShareGame(
  game: GameRecord,
  username: string
): Promise<{ code: string; existing: boolean }> {
  return req("/api/games", {
    method: "POST",
    body: JSON.stringify({ game, username }),
  });
}

export function apiGetGame(code: string): Promise<{
  game: unknown;
  code: string;
  uploadedBy: string;
  uploadedAt: string;
}> {
  return req(`/api/games/${encodeURIComponent(code.trim())}`);
}

export function apiPutOwn(
  code: string,
  username: string,
  comments: OwnComments
): Promise<{ ok: boolean; saved: number }> {
  return req(
    `/api/games/${encodeURIComponent(code)}/annotations/${encodeURIComponent(username)}`,
    { method: "PUT", body: JSON.stringify({ comments }) }
  );
}

export function apiGetOwn(
  code: string,
  username: string
): Promise<AnnotatorRecord> {
  return req(
    `/api/games/${encodeURIComponent(code)}/annotations/${encodeURIComponent(username)}`
  );
}

export function apiGetAll(code: string): Promise<AnnotatorRecord[]> {
  return req(`/api/games/${encodeURIComponent(code)}/annotations`);
}

// Merged annotated game (every annotator's comments, attributed). Raw JSON —
// callers normalize with lib/upgrade before using it as a GameRecord.
export function apiGetExport(code: string): Promise<unknown> {
  return req(`/api/games/${encodeURIComponent(code)}/export`);
}
