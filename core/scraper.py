"""
core/scraper.py
---------------
Phase 1 of the library build: walk the .exFAT site's paginated grid and
capture every game's metadata + LOCKED link-lock URLs. This is the fast part
— no per-link browser unlocking. Links are decrypted offline later, on demand,
by core/decrypt.py.

Needs a Chromium-capable browser via Playwright. It will attach to a running
Brave/Chrome on the CDP debug port if one is found, otherwise launch its own
headless Chromium.
"""
from __future__ import annotations

import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Callable


def _fix_playwright_browsers_path() -> None:
    """When frozen by PyInstaller, Playwright looks for its browser inside
    the exe's temp unpack dir, where it isn't. Point it at the standard
    location where `playwright install chromium` actually puts browsers:
        Windows:  %USERPROFILE%\\AppData\\Local\\ms-playwright
        macOS:    ~/Library/Caches/ms-playwright
        Linux:    ~/.cache/ms-playwright
    Only set if the user hasn't set it themselves.
    """
    if os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
        return
    candidates = []
    if sys.platform.startswith("win"):
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidates.append(Path(local) / "ms-playwright")
    elif sys.platform == "darwin":
        candidates.append(Path.home() / "Library" / "Caches" / "ms-playwright")
    else:
        candidates.append(Path.home() / ".cache" / "ms-playwright")
    for c in candidates:
        if c.is_dir():
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(c)
            return


# Must run before playwright is imported anywhere.
_fix_playwright_browsers_path()

BASE_URL = "https://pippo26442999.github.io/.exFAT/"
SITE_PASSWORD = "pippo"
CDP_URL = os.environ.get("DLPSGAME_CDP_URL", "http://localhost:9222")

PAGE_LOAD_TIMEOUT_MS = 60_000
CARD_WAIT_TIMEOUT_MS = 30_000
NEXT_PAGE_PAUSE_MS = 1200


# --- Card extraction JS (same selectors as the proven scraper) -----------------

CARD_EXTRACT_JS = r"""
() => {
  function parseOpenDL(a) {
    const onclick = a.getAttribute('onclick') || '';
    const m = onclick.match(/openDL\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*'([^']*)'\s*\)/);
    if (!m) {
      const m2 = onclick.match(/openDL\(\s*'([^']+)'/);
      return { url: m2 ? m2[1] : (a.href || ''), credits_files: '',
               credits_backport: '', credits_dlc: '', is_dlc: false,
               is_dump: false, title: '' };
    }
    return {
      url: m[1].replace(/&amp;/g, '&'),
      credits_files: m[2], credits_backport: m[3], credits_dlc: m[4],
      is_dlc: m[6] === 'true', is_dump: m[7] === 'true', title: m[8],
    };
  }
  function sectionFromLabel(text) {
    const t = (text || '').replace(/[:\s]+$/g, '').trim().toUpperCase();
    if (!t) return 'game';
    if (t === 'STANDARD') return 'standard';
    if (t === 'BACKPORT') return 'backport';
    if (t.startsWith('BACKPORT ')) {
      return 'backport_' + t.slice(9).toLowerCase().replace(/\s+/g, '_');
    }
    if (t === 'DLCS' || t === 'DLC') return 'dlcs';
    if (t === 'DUMP') return 'dump';
    return t.toLowerCase().replace(/\s+/g, '_');
  }
  function parseCard(card) {
    const titleEl = card.querySelector('.game-title');
    const title = titleEl ? titleEl.textContent.trim() : '';
    if (!title) return null;
    const img = card.querySelector('.image-container img');
    const cover = img ? (img.currentSrc || img.src || img.getAttribute('src') || '') : '';
    const tags = Array.from(card.querySelectorAll('.tags-overlay .game-tag'))
      .map(el => el.textContent.trim()).filter(Boolean);
    const sizeEl = card.querySelector('.game-size');
    const sizeBadge = sizeEl ? sizeEl.textContent.trim() : '';
    if (sizeBadge && !tags.includes(sizeBadge)) tags.push(sizeBadge);
    const sections = [];
    let current = { section: 'game', links: [] };
    const ds = card.querySelector('.download-section');
    if (ds) {
      for (const el of Array.from(ds.children)) {
        if (el.tagName === 'P' && el.classList.contains('ver-label')) {
          if (current.links.length) sections.push(current);
          current = { section: sectionFromLabel(el.textContent), links: [] };
        } else if (el.classList && el.classList.contains('download-container')) {
          for (const a of el.querySelectorAll('a[onclick]')) {
            const info = parseOpenDL(a);
            current.links.push({
              label: (a.textContent || '').trim().toUpperCase(), ...info });
          }
        }
      }
      if (current.links.length) sections.push(current);
    }
    let credits = { files: '', backport: '', dlc: '' };
    for (const sec of sections) {
      for (const lnk of sec.links) {
        if (!credits.files    && lnk.credits_files)    credits.files    = lnk.credits_files;
        if (!credits.backport && lnk.credits_backport) credits.backport = lnk.credits_backport;
        if (!credits.dlc      && lnk.credits_dlc)      credits.dlc      = lnk.credits_dlc;
      }
    }
    return { title, cover, tags, sections, credits };
  }
  return Array.from(document.querySelectorAll('.game-card'))
    .map(parseCard).filter(c => c !== null);
}
"""


# --- Badge parsing -------------------------------------------------------------

PPSA_RE = re.compile(r"^PPSA\d{4,6}$", re.I)
VERSION_RE = re.compile(r"^v\d+(\.\d+){1,3}$", re.I)
REGION_RE = re.compile(
    r"^(EUR|USA|JPN|ASIA|UK|GER|FRA|ITA|ESP|RUS|KOR|CHN|HK|MULTI|"
    r"Region Bypass|USA \+ Italian Mod|USA to EUR Languages)$", re.I)
SIZE_RE = re.compile(r"^[\d.]+\s*(GB|MB|TB)$", re.I)
BACKPORT_RE = re.compile(
    r"(BackPork|BackPort|FW\s*\d|\d\.x{1,2}|firmware|beyond|Standard)", re.I)
DLC_BADGE_RE = re.compile(r"DLCs?\s*Merged", re.I)


def parse_badges(tags: list[str]) -> dict:
    out = {"ppsa": "", "version": "", "region": "", "size": "",
           "backport_text": "", "dlcs_merged": False, "other_badges": []}
    for t in tags:
        t = (t or "").strip()
        if not t:
            continue
        if not out["ppsa"] and PPSA_RE.match(t):
            out["ppsa"] = t.upper()
        elif not out["version"] and VERSION_RE.match(t):
            out["version"] = t
        elif not out["region"] and REGION_RE.match(t):
            out["region"] = t
        elif not out["size"] and SIZE_RE.match(t.replace(" ", "")):
            out["size"] = t
        elif DLC_BADGE_RE.search(t):
            out["dlcs_merged"] = True
        elif BACKPORT_RE.search(t):
            out["backport_text"] = (out["backport_text"] + "; " + t).lstrip("; ")
        else:
            out["other_badges"].append(t)
    return out


def absolutize_cover(cover: str) -> str:
    if not cover:
        return ""
    if cover.startswith(("http://", "https://", "data:")):
        return cover
    return BASE_URL + cover.lstrip("./")


# --- Playwright plumbing -------------------------------------------------------

class Browser:
    """Owns the Playwright context. Attaches to a running browser on the CDP
    port if available, else launches headless Chromium."""

    def __init__(self, headless: bool = True):
        self._pw = None
        self._ctx = None
        self._owns_browser = False
        self._headless = headless

    def start(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        # Try CDP attach first (warmed-up Brave with Cloudflare clearance)
        try:
            with urllib.request.urlopen(CDP_URL + "/json/version", timeout=2) as r:
                r.read()
            browser = self._pw.chromium.connect_over_cdp(CDP_URL)
            self._ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            return "attached"
        except Exception:
            pass
        # Launch own headless Chromium
        from pathlib import Path
        profile = Path.home() / ".exfat_app_profile"
        profile.mkdir(exist_ok=True)
        self._ctx = self._pw.chromium.launch_persistent_context(
            user_data_dir=str(profile),
            headless=self._headless,
            viewport={"width": 1400, "height": 900},
            args=["--disable-blink-features=AutomationControlled",
                  "--no-sandbox", "--disable-dev-shm-usage"],
        )
        self._owns_browser = True
        return "launched"

    @property
    def ctx(self):
        return self._ctx

    def stop(self):
        try:
            if self._owns_browser and self._ctx:
                self._ctx.close()
            if self._pw:
                self._pw.stop()
        except Exception:
            pass


def _pass_site_gate(page, password: str) -> bool:
    page.wait_for_timeout(800)
    if not page.evaluate("() => !!document.querySelector('input[type=password]')"):
        return True
    try:
        page.fill("input[type=password]", password)
    except Exception:
        return False
    clicked = page.evaluate("""
        () => {
          const t = document.querySelector('button[type=submit], input[type=submit]');
          if (t) { t.click(); return true; }
          const x = Array.from(document.querySelectorAll('button, input[type=button]'))
            .find(b => /unlock|enter|submit|go/i.test(b.textContent || b.value || ''));
          if (x) { x.click(); return true; }
          return false;
        }
    """)
    if not clicked:
        try:
            page.press("input[type=password]", "Enter")
        except Exception:
            pass
    import time
    deadline = time.time() + 15
    while time.time() < deadline:
        gone = page.evaluate("""
            () => {
              const p = document.querySelector('input[type=password]');
              if (!p) return true;
              const r = p.getBoundingClientRect();
              return r.width === 0 || r.height === 0;
            }
        """)
        if gone:
            return True
        page.wait_for_timeout(300)
    return True  # proceed; cards check will catch a real failure


def _get_page_count(page) -> int:
    try:
        info = page.text_content("#page-info") or ""
    except Exception:
        info = ""
    m = re.search(r"of\s+(\d+)", info)
    return int(m.group(1)) if m else 1


def _current_page(page) -> int:
    try:
        info = page.text_content("#page-info") or ""
    except Exception:
        info = ""
    m = re.search(r"Page\s+(\d+)", info)
    return int(m.group(1)) if m else 1


def _go_to_page_one(page):
    import time
    for _ in range(20):
        if _current_page(page) == 1:
            return
        clicked = page.evaluate("""
            () => { const b=document.querySelector('#prev-page');
                    if(!b||b.disabled) return false; b.click(); return true; }
        """)
        if not clicked:
            return
        page.wait_for_timeout(NEXT_PAGE_PAUSE_MS)


def _next_page(page) -> bool:
    clicked = page.evaluate("""
        () => { const b=document.querySelector('#next-page');
                if(!b||b.disabled) return false; b.click(); return true; }
    """)
    if clicked:
        page.wait_for_timeout(NEXT_PAGE_PAUSE_MS)
    return clicked


# --- The fast scrape -----------------------------------------------------------

def _section_kind(name: str) -> str:
    n = (name or "").lower()
    if n in ("standard", "game", ""):
        return "game"
    if n.startswith("backport"):
        return "backport"
    if n in ("dlcs", "dlc"):
        return "dlc"
    if n == "update":
        return "update"
    if n in ("fix", "patch", "fix_patch"):
        return "fix"
    return "other"


def _listing_signature(card: dict) -> str:
    """A dedup key that treats genuinely-different builds as distinct.

    Two cards are the SAME listing only if title, PPSA, version, region,
    firmware/backport text AND their set of download sections all match.
    This keeps separate entries for e.g. a 9.xx Standard build vs a 4.xx
    BackPort build of the same game (same title/PPSA but different firmware),
    instead of dropping the second one as a 'duplicate'.
    """
    meta = parse_badges(card.get("tags") or [])
    title = (card.get("title") or "").strip().lower()
    # Section names capture structural differences (standard/backport_4.xx/dump…)
    secs = sorted((s.get("section") or "").lower()
                  for s in (card.get("sections") or []))
    parts = [
        title,
        (meta.get("ppsa") or "").lower(),
        (meta.get("version") or "").lower(),
        (meta.get("region") or "").lower(),
        (meta.get("backport_text") or "").lower(),
        "|".join(secs),
    ]
    return "::".join(parts)


def _card_from_json_entry(entry: dict) -> dict:
    """Convert one exFAT.json entry into the internal `card` shape that
    card_to_game() consumes (title / cover / tags / sections / credits).

    pippo's JSON stores each download link as a field whose name encodes the
    build group and the host, in one of three styles:
        <group>_<host>   e.g. backport_akia, standard_viki, backport7xx_data,
                              dlc_akia, dump_viki
        <host>_url       e.g. akia_url, viki_url        (plain game build)
        <host>           e.g. akia, viki, data          (plain game build)
    Hosts: akia, viki, data, filek, vault, buzz (+ any future ones).
    Empty-string link fields are skipped.
    """
    HOSTS = {"akia", "viki", "data", "filek", "vault", "buzz", "mega",
             "gofile", "pixeldrain", "mediafire", "rootz", "filek"}

    title = (entry.get("title") or "").strip()
    cover = entry.get("image") or entry.get("cover") or ""
    tags = list(entry.get("tags") or [])

    # pippo's JSON keeps the size in its own field, not in tags. parse_badges
    # only reads tags, so fold the size in (if not already present as a tag).
    size_field = (entry.get("size") or "").strip()
    if size_field and not any(
            SIZE_RE.match((t or "").replace(" ", "")) for t in tags):
        tags.append(size_field)

    credits = {
        "files": entry.get("credits_files", "") or "",
        "backport": entry.get("credits_backport", "") or "",
        "dlc": entry.get("credits_dlc", "") or entry.get("credits_dlcs", "")
        or "",
    }

    # group_name -> list of {label, url, is_dlc, is_dump}
    groups: dict[str, list[dict]] = {}

    def host_label(h: str) -> str:
        return {
            "akia": "AkiraBox", "viki": "VikingFile", "data": "DataNodes",
            "filek": "FileKeeper", "vault": "DataVault", "buzz": "BuzzHeavier",
            "mega": "Mega", "gofile": "GoFile", "pixeldrain": "PixelDrain",
            "mediafire": "MediaFire", "rootz": "Rootz",
        }.get(h, h.title())

    def add(group: str, host: str, url: str):
        if not url or not isinstance(url, str):
            return
        if "decrypt" not in url and "link-lock" not in url and \
           "http" not in url:
            return
        g = group.lower()
        is_dlc = g.startswith("dlc")
        is_dump = g.startswith("dump")
        groups.setdefault(g, []).append({
            "label": host_label(host),
            "url": url,
            "is_dlc": is_dlc,
            "is_dump": is_dump,
        })

    for key, val in entry.items():
        if not isinstance(val, str) or not val:
            continue
        k = key.lower()
        # style 2: <host>_url  -> plain game build
        if k.endswith("_url"):
            host = k[:-4]
            if host in HOSTS:
                add("standard", host, val)
            continue
        # style 1: <group>_<host>
        if "_" in k:
            grp, host = k.rsplit("_", 1)
            if host in HOSTS and grp:
                add(grp, host, val)
                continue
        # style 3: bare <host>
        if k in HOSTS:
            add("standard", k, val)

    # Build the sections list in card shape. Map JSON group names to the
    # section names card_to_game/_section_kind already understand.
    def section_name(group: str) -> str:
        g = group.lower()
        if g == "standard":
            return "standard"
        if g == "backport":
            return "backport"
        if g.startswith("backport"):          # backport7xx -> backport_7.xx
            tier = g[len("backport"):]
            tier = tier.replace("xx", ".xx") if "xx" in tier and \
                "." not in tier else tier
            # backport7xx -> 7.xx ; backport4xx -> 4.xx
            import re as _re
            m = _re.match(r"(\d)\.?xx", tier)
            if m:
                return f"backport_{m.group(1)}.xx"
            return "backport"
        if g.startswith("dlc"):
            return "dlcs"
        if g.startswith("dump"):
            return "dump"
        return g

    sections = []
    for group, links in groups.items():
        if not links:
            continue
        sections.append({"section": section_name(group), "links": links})

    return {
        "title": title,
        "cover": cover,
        "tags": tags,
        "sections": sections,
        "credits": credits,
    }


def card_to_game(card: dict) -> dict:
    """Convert a scraped card into a stored game dict. Keeps the LOCKED URLs;
    resolved URLs are filled in later, on demand, by core/decrypt.py."""
    meta = parse_badges(card["tags"])
    raw_sections: dict[str, list[dict]] = {}
    dlc_count = 0
    for sec in card["sections"]:
        sec_name = sec["section"]
        recs = []
        for lnk in sec["links"]:
            recs.append({
                "label": lnk["label"],
                "locked_url": lnk["url"],
                "resolved_url": "",      # filled on demand
                "host": "",
                "is_dlc": lnk.get("is_dlc", False),
                "is_dump": lnk.get("is_dump", False),
            })
        raw_sections[sec_name] = recs
        if _section_kind(sec_name) == "dlc" and recs:
            dlc_count += 1
    return {
        "source": "exfat",
        "title": card["title"],
        "url": BASE_URL,
        "cover": absolutize_cover(card.get("cover", "")),
        "ppsa": meta["ppsa"],
        "version": meta["version"],
        "region": meta["region"],
        "size": meta["size"],
        "backport_text": meta["backport_text"],
        "dlcs_merged": meta["dlcs_merged"],
        "has_dlc": dlc_count > 0 or meta["dlcs_merged"],
        "dlc_count": dlc_count,
        "other_badges": meta["other_badges"],
        "tags_raw": card["tags"],
        "credits": card.get("credits", {}),
        "exfat_raw_sections": raw_sections,
    }


EXFAT_JSON_URL = BASE_URL + "exFAT.json"


def scrape_library(password: str = SITE_PASSWORD,
                    progress: Callable[[str, int, int], None] | None = None,
                    headless: bool = True,
                    max_pages: int = 0) -> list[dict]:
    """Fetch the library directly from exFAT.json and return a list of game
    dicts (with locked URLs, decrypted later on demand by core/decrypt.py).

    pippo moved the library from rendered HTML cards to a single JSON data
    file, so there's no browser/page-walk any more — one HTTP request gets
    everything. `headless` and `max_pages` are kept for signature
    compatibility; `max_pages` (if set) caps the number of entries processed.

    progress(message, current, total) is called as entries are processed so
    the UI can show a progress bar.
    """
    def report(msg, cur=0, tot=0):
        if progress:
            try:
                progress(msg, cur, tot)
            except Exception:
                pass

    report("Fetching library data…", 0, 0)

    # 1. Download exFAT.json. Try a normal urllib request first; if that's
    #    blocked (Cloudflare), fall back to cloudscraper, then to a browser
    #    fetch as a last resort.
    raw_text = ""
    last_err = ""
    try:
        req = urllib.request.Request(
            EXFAT_JSON_URL,
            headers={"User-Agent": "Mozilla/5.0 (exFAT-Ripper)"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw_text = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        last_err = str(e)
        try:
            import cloudscraper  # type: ignore
            sc = cloudscraper.create_scraper()
            resp = sc.get(EXFAT_JSON_URL, timeout=30)
            if resp.ok:
                raw_text = resp.text
        except Exception as e2:
            last_err = f"{last_err} / {e2}"

    # Last resort: pull it through a real browser (handles Cloudflare JS).
    if not raw_text:
        try:
            raw_text = _fetch_json_via_browser(EXFAT_JSON_URL, headless)
        except Exception as e3:
            last_err = f"{last_err} / browser: {e3}"

    if not raw_text:
        raise RuntimeError(
            "Could not download the library data (exFAT.json). The site may "
            "be unreachable or behind a Cloudflare challenge. "
            f"({last_err})")

    # 2. Parse JSON.
    import json as _json
    try:
        data = _json.loads(raw_text)
    except Exception as e:
        raise RuntimeError(f"Library data wasn't valid JSON: {e}")
    if isinstance(data, dict):
        data = data.get("games") or data.get("entries") or []
    if not isinstance(data, list):
        raise RuntimeError("Unexpected library data format.")

    if max_pages:
        data = data[:max_pages]

    # 3. Convert each entry -> game dict, deduping genuinely-identical listings.
    games: list[dict] = []
    seen: set[str] = set()
    total = len(data)
    for idx, entry in enumerate(data, 1):
        if not isinstance(entry, dict):
            continue
        try:
            card = _card_from_json_entry(entry)
            if not card.get("sections"):
                continue  # entry with no resolvable links — skip
            key = _listing_signature(card)
            if key in seen:
                continue
            seen.add(key)
            games.append(card_to_game(card))
        except Exception:
            continue
        if idx % 25 == 0 or idx == total:
            report(f"Processing {idx}/{total} — {len(games)} games",
                   idx, total)

    report(f"Done — {len(games)} games", total, total)
    return games


def _fetch_json_via_browser(url: str, headless: bool = True) -> str:
    """Last-resort fetch of a JSON URL through Playwright (clears Cloudflare
    JS challenges a plain request can't). Returns the response body text."""
    browser = Browser(headless=headless)
    try:
        browser.start()
        page = browser.ctx.new_page()
        try:
            resp = page.goto(url, wait_until="domcontentloaded",
                             timeout=PAGE_LOAD_TIMEOUT_MS)
            # If Cloudflare interstitial, give it a moment then re-read.
            body = page.evaluate("() => document.body ? document.body.innerText : ''")
            txt = (body or "").strip()
            if txt.startswith("[") or txt.startswith("{"):
                return txt
            if resp:
                try:
                    return resp.text()
                except Exception:
                    pass
            return txt
        finally:
            try:
                page.close()
            except Exception:
                pass
    finally:
        browser.stop()

