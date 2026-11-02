"""
core/cover_cache.py
-------------------
Manages local caching of game cover images.

Covers are stored in <data_dir>/covers/<ppsa>.jpg  (or .png)
The path is stored in the game dict as  cover_local_path.

Public API
----------
  ensure_cover(game, data_dir, progress=None) -> str | None
      Download and cache cover for one game. Returns local path or None.

  repair_missing(games, data_dir, progress=None) -> int
      Re-download covers that are missing from disk. Returns count fixed.

  cover_url_for_game(game) -> str | None
      Best available cover URL from game dict.
"""
from __future__ import annotations

import hashlib
import re
import time
import urllib.request
from pathlib import Path
from typing import Callable


# --- helpers -----------------------------------------------------------------

def _safe_filename(ppsa: str, url: str) -> str:
    """Stable filename based on PPSA code + URL extension."""
    ext = ".jpg"
    if url:
        m = re.search(r"\.(jpg|jpeg|png|webp)", url.lower())
        if m:
            ext = "." + m.group(1)
            if ext == ".jpeg":
                ext = ".jpg"
    safe_ppsa = re.sub(r"[^A-Za-z0-9_-]", "_", ppsa or "unknown")
    return f"{safe_ppsa}{ext}"


def _download(url: str, dest: Path, timeout: int = 12) -> bool:
    """Download url to dest. Returns True on success."""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (exFAT-Ripper/2.0)"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        if len(data) < 512:          # too small → probably an error page
            return False
        dest.write_bytes(data)
        return True
    except Exception:
        return False


def cover_url_for_game(game: dict) -> str | None:
    """Return the best available remote cover URL from a game dict."""
    # enriched metadata wins over scraped thumbnail
    for key in ("cover_url", "cover", "thumbnail", "image"):
        v = game.get(key)
        if v and isinstance(v, str) and v.startswith("http"):
            return v
    # check nested enrichment
    meta = game.get("enrichment") or {}
    for key in ("cover_url", "background_image", "cover"):
        v = meta.get(key)
        if v and isinstance(v, str) and v.startswith("http"):
            return v
    return None


# --- main API ----------------------------------------------------------------

def ensure_cover(
    game: dict,
    data_dir: Path,
    force: bool = False,
    progress_fn: Callable[[str], None] | None = None,
) -> str | None:
    """
    Download and cache cover for one game.

    Returns the local path string if available (newly downloaded or already
    cached), or None if no cover URL could be found / download failed.
    """
    covers_dir = data_dir / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

    ppsa = (game.get("ppsa") or "").strip()
    url = cover_url_for_game(game)

    # 1. Already have a valid local path?
    local = game.get("cover_local_path", "")
    if local and not force:
        p = Path(local)
        if p.exists() and p.stat().st_size > 512:
            return str(p)

    if not url:
        return local if local else None   # nothing to download

    # 2. Build dest path
    fname = _safe_filename(ppsa or hashlib.md5(url.encode()).hexdigest()[:8], url)
    dest = covers_dir / fname

    # 3. Already downloaded (path might differ from what's stored)
    if dest.exists() and dest.stat().st_size > 512 and not force:
        return str(dest)

    # 4. Download
    if progress_fn:
        progress_fn(f"Downloading cover for {game.get('title', ppsa)}…")

    ok = _download(url, dest)
    if ok:
        return str(dest)

    # 5. Fallback: try other cover fields
    for key in ("cover", "thumbnail", "image", "cover_url"):
        alt = game.get(key)
        if alt and alt != url and isinstance(alt, str) and alt.startswith("http"):
            if _download(alt, dest):
                return str(dest)

    return None


def repair_missing(
    games: list[dict],
    data_dir: Path,
    progress_fn: Callable[[str, int, int], None] | None = None,
    max_workers: int = 8,
) -> int:
    """
    Re-download covers that are missing from disk.
    Mutates game dicts in-place with updated cover_local_path.
    Returns number of covers repaired.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    needed: list[dict] = []
    for g in games:
        local = g.get("cover_local_path", "")
        if not local or not Path(local).exists() or Path(local).stat().st_size <= 512:
            needed.append(g)

    if not needed:
        return 0

    total = len(needed)
    repaired = 0

    def _worker(game: dict) -> tuple[dict, str | None]:
        path = ensure_cover(game, data_dir, force=True)
        return game, path

    with ThreadPoolExecutor(max_workers=min(max_workers, max(1, total))) as executor:
        futures = {executor.submit(_worker, g): g for g in needed}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                game, path = fut.result()
                if path:
                    game["cover_local_path"] = path
                    repaired += 1
            except Exception:
                pass
            if progress_fn and (i % 5 == 0 or i == total):
                progress_fn(f"Repairing covers {i}/{total}…", i, total)

    return repaired


def bulk_cache_covers(
    games: list[dict],
    data_dir: Path,
    progress_fn: Callable[[str, int, int], None] | None = None,
    max_workers: int = 8,
) -> int:
    """
    Cache covers for all games that don't already have a local copy.
    Mutates game dicts in-place with cover_local_path.
    Downloads concurrently for high speed.
    Returns number of new covers downloaded.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    covers_dir = data_dir / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

    # 1. Quickly filter games that actually need a cover
    needed: list[dict] = []
    for g in games:
        local = g.get("cover_local_path", "")
        if local and Path(local).exists() and Path(local).stat().st_size > 512:
            continue
        ppsa = (g.get("ppsa") or "").strip()
        url = cover_url_for_game(g)
        if url:
            fname = _safe_filename(ppsa or hashlib.md5(url.encode()).hexdigest()[:8], url)
            dest = covers_dir / fname
            if dest.exists() and dest.stat().st_size > 512:
                g["cover_local_path"] = str(dest)
                continue
        needed.append(g)

    if not needed:
        return 0

    total = len(needed)
    downloaded = 0

    def _worker(game: dict) -> tuple[dict, str | None]:
        path = ensure_cover(game, data_dir)
        return game, path

    with ThreadPoolExecutor(max_workers=min(max_workers, max(1, total))) as executor:
        futures = {executor.submit(_worker, g): g for g in needed}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                game, path = fut.result()
                if path:
                    game["cover_local_path"] = path
                    downloaded += 1
            except Exception:
                pass
            if progress_fn and (i % 5 == 0 or i == total):
                progress_fn(f"Caching covers {i}/{total}…", i, total)

    return downloaded
