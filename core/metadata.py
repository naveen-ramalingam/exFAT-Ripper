"""
core/metadata.py
----------------
Enriches scraped game records with metadata from external APIs.

SCRAPED DATA IS NEVER OVERWRITTEN — this module only adds/updates the
'enrichment' sub-dict inside each game record.

Supported sources (tried in order):
  1. RAWG API      — descriptions, ratings, genres, screenshots, release date,
                     publisher, developer, Metacritic score.
  2. IGDB API      — covers, screenshots, summaries, genres, release dates.
                     Requires Twitch Client-ID + token (OAuth).
  3. Steam Web API — fallback for PC-matching titles (no key needed for search).

Public API
----------
  enrich_game(game, settings) -> dict
      Fetch metadata for one game. Mutates the 'enrichment' key in-place.
      Returns the enrichment dict.

  batch_enrich(games, settings, progress_fn) -> int
      Enrich all games missing metadata. Returns count enriched.

Settings dict keys
------------------
  rawg_api_key      str   RAWG API key (optional, higher rate limits)
  igdb_client_id    str   Twitch/IGDB Client-ID
  igdb_token        str   Twitch OAuth token
  auto_enrich       bool  Enrich on scrape
"""
from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable

log = logging.getLogger("exfat_ripper.metadata")

# Records the reason the most recent fetch attempt failed, so the UI and the
# log can show *why* a game was not enriched (instead of silently returning {}).
# Reset at the start of each enrich_game() call.
_LAST_ERROR: dict[str, str | None] = {"reason": None}


def last_error() -> str | None:
    """Return a human-readable reason for the most recent enrichment miss."""
    return _LAST_ERROR.get("reason")


def _set_error(reason: str | None) -> None:
    _LAST_ERROR["reason"] = reason
    if reason:
        log.warning("metadata: %s", reason)

# Edition / platform suffixes to strip before matching
_STRIP_PATTERNS = re.compile(
    r"\b(ultimate|deluxe|complete|definitive|standard|premium|gold|digital|"
    r"remastered|remake|enhanced|expanded|anniversary|game of the year|goty|"
    r"directors? cut|extended|special|limited|collectors?|bundle|edition|"
    r"ps5|ps4|playstation\s*5|playstation\s*4|ps\s*5|ps\s*4|"
    r"dlc|expansion|pack|season pass|upgrade|content)\b",
    re.IGNORECASE,
)

_MULTI_SPACE = re.compile(r"\s{2,}")


# --- Issue #01c: second-pass search ------------------------------------------
# Known multi-word edition PHRASES that RAWG typically does not index as their
# own catalog entry (it indexes the base game instead). When a full-title search
# scores poorly, we strip a trailing edition phrase and retry with the base
# title. Deliberately a SHORT, explicit list of phrases we have actually seen —
# not a general heuristic engine. Add to it only when a real title needs it.
_EDITION_PHRASES = [
    "forty years of wrestlemania edition",
    "40 years of wrestlemania edition",
    "digital deluxe edition",
    "game of the year edition",
    "collector's edition",
    "collectors edition",
    "definitive edition",
    "complete edition",
    "ultimate edition",
    "champions edition",
    "founder's edition",
    "founders edition",
    "premium edition",
    "special edition",
    "deluxe edition",
    "gold edition",
    "director's cut",
    "directors cut",
]


def strip_edition_phrase(title: str) -> str | None:
    """
    If `title` ends with a known edition phrase, return the base title with that
    phrase removed. Otherwise return None (meaning: nothing to strip, no second
    pass needed). Case-insensitive; only strips a trailing phrase so we don't
    mangle titles where such words appear mid-name.
    """
    t = (title or "").strip()
    low = t.lower()
    for phrase in _EDITION_PHRASES:
        if low.endswith(phrase):
            base = t[: len(t) - len(phrase)]
            base = re.sub(r"[\s:\-–—]+$", "", base).strip()
            if base and base.lower() != low:
                return base
    return None


def clean_title(title: str) -> str:
    """Strip edition/platform noise for better API matching."""
    t = _STRIP_PATTERNS.sub(" ", title or "")
    t = _MULTI_SPACE.sub(" ", t).strip()
    # Remove trailing/leading punctuation
    t = re.sub(r"^[\s:\-–—]+|[\s:\-–—]+$", "", t)
    return t


# --- HTTP helpers ------------------------------------------------------------

def _get_json(url: str, headers: dict | None = None, timeout: int = 5) -> dict | list | None:
    try:
        req = urllib.request.Request(url, headers=headers or {})
        req.add_header("User-Agent", "exFAT-Ripper/2.0")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        # Read the body so we can show RAWG/IGDB's own error message.
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        if e.code in (401, 403):
            _set_error(f"API rejected request ({e.code}) — check your API key. {body}".strip())
        elif e.code == 429:
            _set_error("API rate limit hit (429) — add/verify an API key or wait a moment.")
        else:
            _set_error(f"API HTTP {e.code}. {body}".strip())
        return None
    except urllib.error.URLError as e:
        _set_error(f"Network error reaching API: {e.reason}")
        return None
    except Exception as e:
        _set_error(f"Unexpected error: {type(e).__name__}: {e}")
        return None


def _get_json_verbose(url: str, timeout: int = 10) -> tuple[int | None, object | None, str]:
    """
    Like _get_json but returns (http_status, parsed_json_or_None, note).

    Used by rawg_probe() for diagnostics so the caller can see the exact
    status code and a short note, without the normal silent-None collapse.
    On HTTP errors, http_status is the code; on network errors it is None.
    """
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "exFAT-Ripper/2.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", errors="replace")
            try:
                return r.status, json.loads(raw), ""
            except Exception:
                return r.status, None, f"Body was not valid JSON ({len(raw)} bytes)."
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        return e.code, None, body or e.reason or ""
    except urllib.error.URLError as e:
        return None, None, f"Network error: {e.reason}"
    except Exception as e:
        return None, None, f"{type(e).__name__}: {e}"


def _post_json(url: str, body: bytes, headers: dict, timeout: int = 10) -> dict | list | None:
    try:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        req.add_header("User-Agent", "exFAT-Ripper/2.0")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        bd = ""
        try:
            bd = e.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        _set_error(f"API HTTP {e.code}. {bd}".strip())
        return None
    except urllib.error.URLError as e:
        _set_error(f"Network error reaching API: {e.reason}")
        return None
    except Exception as e:
        _set_error(f"Unexpected error: {type(e).__name__}: {e}")
        return None


# --- RAWG --------------------------------------------------------------------

def _rawg_search(title: str, api_key: str | None, min_score: int = 20) -> dict | None:
    """Search RAWG and return the best matching result dict, or None.

    `min_score` is the acceptance threshold. The base-title second pass uses a
    higher value than the default first pass, because a deliberately shortened
    title is more prone to grabbing a loosely-related sibling (e.g. base 'WWE
    2K24' loosely matching 'WWE Legends'); requiring a stronger match guards
    against attaching the wrong game.
    """
    q = urllib.parse.urlencode({"search": title, "page_size": 5})
    key_param = f"&key={api_key}" if api_key else ""
    url = f"https://api.rawg.io/api/games?{q}{key_param}"
    data = _get_json(url)
    if not data or not isinstance(data.get("results"), list):
        return None
    results = data["results"]
    if not results:
        return None
    # Simple scoring: exact or near match wins
    clean = clean_title(title).lower()
    best = None
    best_score = -1
    for r in results:
        name = (r.get("name") or "").lower()
        score = 0
        if name == clean:
            score = 100
        elif clean in name or name in clean:
            score = 50
        else:
            # word overlap ratio
            cw = set(clean.split())
            nw = set(name.split())
            if cw and nw:
                score = int(100 * len(cw & nw) / max(len(cw), len(nw)))
        if score > best_score:
            best_score = score
            best = r
    if best_score < min_score:
        best_name = (best or {}).get("name", "?")
        msg = (
            f"RAWG had no confident match for '{title}' "
            f"(closest: '{best_name}', score {best_score}/{min_score})."
        )
        # If the title carries an edition phrase, hint at the base-game retry.
        if strip_edition_phrase(title):
            msg += " Suggestion: retry using the base game title."
        _set_error(msg)
        return None   # too poor a match
    return best


def _rawg_detail(slug: str, api_key: str | None) -> dict | None:
    key_param = f"?key={api_key}" if api_key else ""
    url = f"https://api.rawg.io/api/games/{slug}{key_param}"
    return _get_json(url)


def _rawg_screenshots(slug: str, api_key: str | None) -> list[str]:
    key_param = f"?key={api_key}" if api_key else ""
    url = f"https://api.rawg.io/api/games/{slug}/screenshots{key_param}"
    data = _get_json(url)
    if not data:
        return []
    return [s["image"] for s in (data.get("results") or []) if s.get("image")][:6]


def _rawg_trailer(slug: str, api_key: str | None) -> dict | None:
    """
    Fetch a trailer for a game from RAWG's free /movies endpoint.
    Returns {name, preview, video} for the first available clip, or None.

    RAWG's /games/{id}/movies returns hosted MP4 clips (not YouTube), so the
    video URL can be played directly in an HTML5 <video> element. Coverage is
    sparse — mostly AAA titles — so None is the common, expected result.
    """
    if not slug:
        return None
    key_param = f"?key={api_key}" if api_key else ""
    url = f"https://api.rawg.io/api/games/{slug}/movies{key_param}"
    data = _get_json(url)
    if not data or not isinstance(data.get("results"), list):
        return None
    for clip in data["results"]:
        # `data` holds the rendition URLs; prefer 'max', fall back to '480'.
        vids = clip.get("data") or {}
        video_url = vids.get("max") or vids.get("480") or ""
        if video_url:
            return {
                "name": clip.get("name") or "Trailer",
                "preview": clip.get("preview") or "",
                "video": video_url,
            }
    return None


def _redact_key(url: str) -> str:
    """Hide the API key in a URL so it is safe to display/log."""
    return re.sub(r"(key=)[^&]+", r"\1<redacted>", url)


def _score_name(clean: str, name: str) -> int:
    """The exact scoring used by _rawg_search, exposed for the probe."""
    n = (name or "").lower()
    if n == clean:
        return 100
    if clean in n or n in clean:
        return 50
    cw = set(clean.split())
    nw = set(n.split())
    if cw and nw:
        return int(100 * len(cw & nw) / max(len(cw), len(nw)))
    return 0


def rawg_probe(title: str, settings: dict) -> dict:
    """
    DIAGNOSTIC — Issue #01a. Probe the RAWG search for a single title and
    return the full request/status/results/match chain. Does NOT enrich or
    mutate anything; purely observational.

    Returns a dict with:
      title, clean_title, key_present, request_url (redacted), http_status,
      result_count, candidates [{name, score}], best_match, best_score,
      threshold, accepted (bool), reason (str)
    """
    api_key = (settings.get("rawg_api_key") or "").strip() or None
    if not api_key:
        return {
            "title": title,
            "clean_title": clean,
            "key_present": False,
            "request_url": "",
            "http_status": None,
            "result_count": 0,
            "candidates": [],
            "best_match": None,
            "best_score": 0,
            "threshold": 20,
            "accepted": False,
            "reason": "No RAWG API key configured in Settings.",
        }
    key_param = f"&key={api_key}" if api_key else ""
    url = f"https://api.rawg.io/api/games?{q}{key_param}"

    status, data, note = _get_json_verbose(url)

    report: dict = {
        "title": title,
        "clean_title": clean,
        "key_present": bool(api_key),
        "request_url": _redact_key(url),
        "http_status": status,
        "result_count": 0,
        "candidates": [],
        "best_match": None,
        "best_score": None,
        "threshold": 20,
        "accepted": False,
        "reason": "",
    }

    if status is None:
        report["reason"] = note or "No response (network error)."
        return report
    if status in (401, 403):
        report["reason"] = f"HTTP {status} — API key rejected or missing. {note}".strip()
        return report
    if status == 429:
        report["reason"] = "HTTP 429 — rate limited (add/verify an API key)."
        return report
    if status != 200:
        report["reason"] = f"HTTP {status}. {note}".strip()
        return report
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        report["reason"] = "HTTP 200 but response shape unexpected (no 'results' list)."
        return report

    results = data["results"]
    report["result_count"] = len(results)
    if not results:
        report["reason"] = "HTTP 200 but RAWG returned 0 results for this title."
        return report

    scored = []
    for r in results:
        nm = r.get("name") or "?"
        scored.append({"name": nm, "score": _score_name(clean_lc, nm)})
    scored.sort(key=lambda x: x["score"], reverse=True)
    report["candidates"] = scored
    report["best_match"] = scored[0]["name"]
    report["best_score"] = scored[0]["score"]

    if scored[0]["score"] >= report["threshold"]:
        report["accepted"] = True
        report["reason"] = "Match accepted."
    else:
        report["accepted"] = False
        report["reason"] = (
            f"Best match '{scored[0]['name']}' scored {scored[0]['score']}, "
            f"below threshold {report['threshold']}."
        )
    return report


def fetch_rawg(title: str, settings: dict) -> dict | None:
    """
    Fetch enrichment from RAWG. Returns a normalised dict or None.
    """
    api_key = (settings.get("rawg_api_key") or "").strip() or None
    if not api_key:
        return None
    clean = clean_title(title)
    result = _rawg_search(clean, api_key)
    if not result:
        # Try original title
        result = _rawg_search(title, api_key)
    if not result:
        # Issue #01c — second pass: strip a known edition phrase and retry with
        # the base title (e.g. "WWE 2K24 Forty Years of WrestleMania Edition"
        # -> "WWE 2K24"). Only fires when such a phrase is actually present.
        # Uses a STRICTER threshold (60) so a shortened title accepts only a
        # near-exact base match, not a loosely-related sibling.
        base = strip_edition_phrase(title)
        if base:
            result = _rawg_search(base, api_key, min_score=60)
            if result:
                _set_error(None)  # clear the poor-match reason from pass 1
    if not result:
        return None

    slug = result.get("slug", "")
    detail = _rawg_detail(slug, api_key) if slug else result
    if not detail:
        detail = result

    screenshots = _rawg_screenshots(slug, api_key) if slug else []
    trailer = _rawg_trailer(slug, api_key) if slug else None

    genres = [g["name"] for g in (detail.get("genres") or [])]
    devs = [d["name"] for d in (detail.get("developers") or [])]
    pubs = [p["name"] for p in (detail.get("publishers") or [])]

    return {
        "source": "rawg",
        "api_id": detail.get("id"),
        "slug": slug,
        "description": detail.get("description_raw") or detail.get("description") or "",
        "rating": detail.get("rating"),
        "rating_count": detail.get("ratings_count"),
        "metacritic": detail.get("metacritic"),
        "release_date": detail.get("released"),
        "genres": genres,
        "developer": ", ".join(devs),
        "publisher": ", ".join(pubs),
        "cover_url": (detail.get("background_image") or ""),
        "screenshots": screenshots,
        "trailer": trailer,
        "website": detail.get("website") or "",
        "playtime": detail.get("playtime"),
    }


# --- IGDB --------------------------------------------------------------------

def _igdb_token(client_id: str, client_secret: str) -> str | None:
    """Obtain a Twitch OAuth token for IGDB access."""
    url = (
        f"https://id.twitch.tv/oauth2/token"
        f"?client_id={urllib.parse.quote(client_id)}"
        f"&client_secret={urllib.parse.quote(client_secret)}"
        f"&grant_type=client_credentials"
    )
    data = _post_json(url, b"", {"Content-Type": "application/x-www-form-urlencoded"})
    if data and "access_token" in data:
        return data["access_token"]
    return None


def fetch_igdb(title: str, settings: dict) -> dict | None:
    """
    Fetch enrichment from IGDB. Requires client_id + token in settings.
    Returns a normalised dict or None.
    """
    client_id = (settings.get("igdb_client_id") or "").strip()
    token = (settings.get("igdb_token") or "").strip()
    if not client_id or not token:
        return None

    headers = {
        "Client-ID": client_id,
        "Authorization": f"Bearer {token}",
        "Content-Type": "text/plain",
    }
    clean = clean_title(title)
    query = (
        f'search "{clean}"; '
        f'fields name,summary,cover.url,genres.name,first_release_date,'
        f'involved_companies.company.name,involved_companies.developer,'
        f'involved_companies.publisher,rating,rating_count,screenshots.url;'
        f'limit 3;'
    )
    data = _post_json(
        "https://api.igdb.com/v4/games",
        query.encode(),
        headers,
    )
    if not data or not isinstance(data, list) or not data:
        return None

    r = data[0]
    devs = [c["company"]["name"] for c in (r.get("involved_companies") or [])
            if c.get("developer") and c.get("company")]
    pubs = [c["company"]["name"] for c in (r.get("involved_companies") or [])
            if c.get("publisher") and c.get("company")]
    genres = [g["name"] for g in (r.get("genres") or [])]
    cover = ""
    if r.get("cover", {}).get("url"):
        cover = "https:" + r["cover"]["url"].replace("t_thumb", "t_cover_big")
    screenshots = []
    for ss in (r.get("screenshots") or [])[:6]:
        if ss.get("url"):
            screenshots.append("https:" + ss["url"].replace("t_thumb", "t_screenshot_big"))

    release = None
    ts = r.get("first_release_date")
    if ts:
        import datetime
        try:
            release = datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
        except Exception:
            pass

    return {
        "source": "igdb",
        "api_id": r.get("id"),
        "description": r.get("summary") or "",
        "rating": round(r["rating"] / 10, 1) if r.get("rating") else None,
        "rating_count": r.get("rating_count"),
        "metacritic": None,
        "release_date": release,
        "genres": genres,
        "developer": ", ".join(devs),
        "publisher": ", ".join(pubs),
        "cover_url": cover,
        "screenshots": screenshots,
        "website": "",
        "playtime": None,
    }


# --- Steam fallback ----------------------------------------------------------

def fetch_steam(title: str, _settings: dict) -> dict | None:
    """
    Basic Steam store search fallback. No API key required.
    Only used if RAWG and IGDB return nothing.
    """
    q = urllib.parse.urlencode({"term": clean_title(title), "l": "en"})
    url = f"https://store.steampowered.com/api/storesearch/?{q}&cc=US"
    data = _get_json(url)
    if not data or not data.get("items"):
        return None
    item = data["items"][0]
    appid = item.get("id")
    if not appid:
        return None

    detail_url = f"https://store.steampowered.com/api/appdetails?appids={appid}&cc=US&l=en"
    detail_data = _get_json(detail_url)
    if not detail_data:
        return None
    app = (detail_data.get(str(appid)) or {}).get("data") or {}
    if not app:
        return None

    genres = [g["description"] for g in (app.get("genres") or [])]
    devs = app.get("developers") or []
    pubs = app.get("publishers") or []
    screenshots = [
        s.get("path_full") for s in (app.get("screenshots") or [])[:6]
        if s.get("path_full")
    ]
    cover = app.get("header_image") or ""

    return {
        "source": "steam",
        "api_id": appid,
        "description": re.sub(r"<[^>]+>", " ", app.get("short_description") or ""),
        "rating": None,
        "rating_count": None,
        "metacritic": (app.get("metacritic") or {}).get("score"),
        "release_date": (app.get("release_date") or {}).get("date"),
        "genres": genres,
        "developer": ", ".join(devs),
        "publisher": ", ".join(pubs),
        "cover_url": cover,
        "screenshots": screenshots,
        "website": app.get("website") or "",
        "playtime": None,
    }


# --- Orchestrator ------------------------------------------------------------

def enrich_game(game: dict, settings: dict) -> dict:
    """
    Fetch enrichment metadata for one game.

    Mutates game["enrichment"] in-place and returns the enrichment dict.
    Scraped fields (firmware, backport, links, etc.) are never touched.
    """
    title = game.get("scraped_title") or game.get("title") or ""
    if not title:
        return {}

    existing = game.get("enrichment") or {}
    # Don't re-fetch if we already have a good description
    if existing.get("description") and existing.get("source"):
        return existing

    _set_error(None)   # clear any prior reason before this attempt
    enrichment = None

    # 1. RAWG
    try:
        enrichment = fetch_rawg(title, settings)
        time.sleep(0.3)
    except Exception:
        pass

    # 2. IGDB fallback
    if not enrichment:
        try:
            enrichment = fetch_igdb(title, settings)
            time.sleep(0.3)
        except Exception:
            pass

    # 3. Steam fallback
    if not enrichment:
        try:
            enrichment = fetch_steam(title, settings)
            time.sleep(0.5)
        except Exception:
            pass

    if enrichment:
        _set_error(None)   # success — clear reason
        game["enrichment"] = enrichment
        # Promote cover_url to top-level for cover cache
        if not game.get("cover") and enrichment.get("cover_url"):
            game["cover"] = enrichment["cover_url"]
        return enrichment

    return {}


def batch_enrich(
    games: list[dict],
    settings: dict,
    progress_fn: Callable[[str, int, int], None] | None = None,
    report: dict | None = None,
) -> int:
    """
    Enrich all games that lack metadata.
    Returns count of games enriched.

    If `report` (a dict) is supplied, it is populated with diagnostics:
        report["failures"] = [{title, reason}, ...]   # per-title misses
        report["rate_limited"] = bool                  # any 429/401 seen
        report["attempted"], report["enriched"], report["skipped"]
    This lets the bulk path explain WHY a game was missed, instead of the
    silent skip that made single-retry-works / bulk-fails indistinguishable.
    """
    total = len(games)
    enriched = 0
    attempted = 0
    failures: list[dict] = []
    rate_limited = False

    for i, game in enumerate(games):
        existing = game.get("enrichment") or {}
        if existing.get("description") and existing.get("source"):
            continue
        title = game.get("scraped_title") or game.get("title") or ""
        if progress_fn:
            progress_fn(f"Enriching {i + 1}/{total}: {title}", i + 1, total)
        attempted += 1
        result = enrich_game(game, settings)
        if result:
            enriched += 1
        else:
            reason = last_error() or "No match found."
            failures.append({"title": title, "reason": reason})
            # Detect throttling so the caller can advise the user.
            low = reason.lower()
            if "429" in low or "rate limit" in low or "401" in low or "403" in low:
                rate_limited = True
        # Pace requests. Back off harder once throttling is detected so the
        # rest of the batch doesn't cascade into the same rate-limit window.
        time.sleep(0.5 if rate_limited else 0.2)

    if report is not None:
        report["failures"] = failures
        report["rate_limited"] = rate_limited
        report["attempted"] = attempted
        report["enriched"] = enriched
        report["skipped"] = total - attempted

    return enriched
