"""GRIT multi-annotator Review API.

One annotator uploads a saved game JSON and gets a short SHARE CODE; other
annotators join with that code (+ a username) and comment independently.

Storage is a plain directory tree (no database — transparent, greppable, and
trivially backed up):

    data/<CODE>/game.json                    # uploaded record, never mutated
    data/<CODE>/meta.json                    # {code, gameId, uploadedBy, uploadedAt}
    data/<CODE>/annotations/<user-slug>.json # {username, comments:{<puzzleIndex>:
                                             #   {comment, at, revealedAt}}}

Each annotator's comments live in their OWN file, so concurrent annotators can
never clobber each other (async independence by construction). Writes are
atomic (tmp + replace). Blindness note: the honest client only requests other
annotators' comments on reveal; this is a lab-trust tool, not a security
boundary (the selections are inside game.json regardless).

Run:
    pip install -r requirements.txt
    python app.py          # http://127.0.0.1:8787 — the web app proxies /api here
"""

from __future__ import annotations

import json
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

SERVER_DIR = Path(__file__).resolve().parent
DATA_DIR = SERVER_DIR / "data"

# Unambiguous alphabet (no 0/O, 1/I/L, U) so codes survive being read aloud.
CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LEN = 6

app = FastAPI(title="GRIT annotation server", version="1.0")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _slug(username: str) -> str:
    """Filename-safe, case-insensitive annotator identity ('Alice' == 'alice')."""
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", username.strip()).strip("-._").lower()[:40]
    if not s:
        raise HTTPException(400, "username required")
    return s


def _norm_code(code: str) -> str:
    c = code.strip().upper()
    if len(c) != CODE_LEN or any(ch not in CODE_ALPHABET for ch in c):
        raise HTTPException(400, f"malformed code (expected {CODE_LEN} chars)")
    return c


def _game_dir(code: str) -> Path:
    d = DATA_DIR / _norm_code(code)
    if not (d / "game.json").exists():
        raise HTTPException(404, "unknown code")
    return d


def _validate_game(game: dict) -> str:
    """Minimal structural check (mirrors the web app's upgradeGameRecord gate).
    Returns the gameId."""
    if not isinstance(game, dict) or game.get("schemaVersion") not in (2, 3):
        raise HTTPException(400, "not a GRIT game record (schemaVersion 2 or 3)")
    meta = game.get("game")
    puzzles = game.get("puzzles")
    if not isinstance(meta, dict) or not isinstance(puzzles, list) or not puzzles:
        raise HTTPException(400, "game record is missing game meta or puzzles")
    game_id = meta.get("gameId")
    if not isinstance(game_id, str) or not game_id:
        raise HTTPException(400, "game record has no gameId")
    return game_id


def _clean_comments(raw: dict) -> dict:
    """Keep only well-formed entries: {puzzleIndex: {comment, at, revealedAt}}.
    An entry earns its place with a non-empty comment OR a recorded reveal."""
    out: dict[str, dict] = {}
    for key, val in raw.items():
        if not str(key).isdigit() or not isinstance(val, dict):
            continue
        comment = str(val.get("comment", "") or "").strip()
        revealed = val.get("revealedAt")
        if not comment and not revealed:
            continue
        out[str(int(key))] = {
            "comment": comment,
            "at": str(val.get("at", "") or _now()),
            "revealedAt": str(revealed) if revealed else None,
        }
    return out


def _annotation_files(d: Path) -> list[Path]:
    ann_dir = d / "annotations"
    return sorted(ann_dir.glob("*.json")) if ann_dir.is_dir() else []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

class UploadBody(BaseModel):
    game: dict
    username: str = ""


class AnnotationsBody(BaseModel):
    comments: dict


@app.post("/api/games")
def upload_game(body: UploadBody):
    game_id = _validate_game(body.game)

    # Dedupe by gameId: re-uploading the same game returns the existing code.
    if DATA_DIR.is_dir():
        for meta_path in DATA_DIR.glob("*/meta.json"):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if meta.get("gameId") == game_id:
                return {"code": meta["code"], "existing": True}

    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
        if not (DATA_DIR / code).exists():
            break

    d = DATA_DIR / code
    _atomic_write(d / "game.json", body.game)
    _atomic_write(
        d / "meta.json",
        {
            "code": code,
            "gameId": game_id,
            "uploadedBy": body.username.strip(),
            "uploadedAt": _now(),
        },
    )
    (d / "annotations").mkdir(parents=True, exist_ok=True)
    return {"code": code, "existing": False}


@app.get("/api/games/{code}")
def get_game(code: str):
    d = _game_dir(code)
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    game = json.loads((d / "game.json").read_text(encoding="utf-8"))
    return {
        "game": game,
        "code": meta["code"],
        "uploadedBy": meta.get("uploadedBy", ""),
        "uploadedAt": meta.get("uploadedAt", ""),
    }


@app.put("/api/games/{code}/annotations/{username}")
def put_annotations(code: str, username: str, body: AnnotationsBody):
    d = _game_dir(code)
    slug = _slug(username)
    comments = _clean_comments(body.comments)
    _atomic_write(
        d / "annotations" / f"{slug}.json",
        {"username": username.strip(), "comments": comments},
    )
    return {"ok": True, "saved": len(comments)}


@app.get("/api/games/{code}/annotations/{username}")
def get_own_annotations(code: str, username: str):
    """A single annotator's record (used on rejoin) — keeps the honest client
    blind: it never has to download other annotators' comments to restore."""
    d = _game_dir(code)
    path = d / "annotations" / f"{_slug(username)}.json"
    if not path.exists():
        return {"username": username.strip(), "comments": {}}
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/games/{code}/annotations")
def get_all_annotations(code: str):
    d = _game_dir(code)
    out = []
    for path in _annotation_files(d):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


@app.get("/api/games/{code}/export")
def export_merged(code: str):
    """The stored game with reviewerAnnotations = every annotator's comments,
    each entry attributed ({annotator, revealedAt}; revealedAt null = blind)."""
    d = _game_dir(code)
    game = json.loads((d / "game.json").read_text(encoding="utf-8"))
    merged = []
    for path in _annotation_files(d):
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for key, val in rec.get("comments", {}).items():
            if not str(val.get("comment", "")).strip():
                continue  # reveal-only entries are not comments
            merged.append(
                {
                    "puzzleIndex": int(key),
                    "comment": val["comment"],
                    "at": val.get("at", ""),
                    "annotator": rec.get("username", path.stem),
                    "revealedAt": val.get("revealedAt"),
                }
            )
    merged.sort(key=lambda a: (a["puzzleIndex"], a["annotator"].lower()))
    game["reviewerAnnotations"] = merged
    return game


if __name__ == "__main__":
    import uvicorn

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"GRIT annotation server — data dir: {DATA_DIR}")
    uvicorn.run(app, host="127.0.0.1", port=8787, log_level="warning")
