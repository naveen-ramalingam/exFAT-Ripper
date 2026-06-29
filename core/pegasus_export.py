"""
core/pegasus_export.py
----------------------
Convert the exFAT library into a Pegasus DL catalog JSON.

Pegasus DL (github.com/pegasus-ps5/pegasus-dl) is a PS5 homebrew downloader
that reads a flat catalog of "packages". This module flattens our nested
game -> sections -> links structure into that format:

  - Each GAME build  -> one package  (category "game")
  - Each BACKPORT / STANDARD build with its own links -> a separate package,
    title suffixed e.g. "(BackPort)", links prefixed e.g. "BackPort - Akia"
  - Each DLC         -> a separate package (category "dlc"), title "(DLC)"
  - Each DUMP        -> a separate package, suffixed "(Dump)"

Every locked link-lock URL is decrypted to a real direct URL. Packages with no
resolvable links are skipped. Covers use the remote poster URL (local cached
paths are useless to the PS5).

Schema (per pegasus-dl docs):
  Required:  titleId, title, downloadLinks[].url
  Optional:  version, posterUrl, description, downloadSource, sizeBytes
"""
from __future__ import annotations

import datetime
import re

from .decrypt import decrypt_link_lock, is_link_lock_url

# Short host labels Pegasus uses in the example catalog
_HOST_SHORT = [
    ("akirabox", "AkiraBox"),
    ("vikingfile", "VikingFile"),
    ("vik1ngfile", "VikingFile"),
    ("datanodes", "DataNodes"),
    ("filekeeper", "FileKeeper"),
    ("datavault", "DataVault"),
    ("buzzheavier", "BuzzHeavier"),
    ("mediafire", "MediaFire"),
    ("1fichier", "1Fichier"),
    ("pixeldrain", "PixelDrain"),
    ("gofile", "GoFile"),
    ("mega.", "Mega"),
    ("rootz", "Rootz"),
]



# Plain-text resolver setup guide written next to every exported catalog.
SETUP_GUIDE = r"""exFAT Ripper — Pegasus DL Setup
================================

You exported a Pegasus catalog (the .json next to this file). Here is how to
actually download the games on your PS5.

1) ADD THE CATALOG
   In Pegasus DL on your PS5: add the exported .json as a catalog source,
   then search and queue packages.

2) YOU ALSO NEED A RESOLVER
   The hosts (AkiraBox, VikingFile, DataNodes) open a provider PAGE, not a
   direct file. Pegasus DL needs a small "resolver" running on a PC on the
   same network to turn those pages into the real download URL. Without it,
   downloads from these hosts will not start.

   OPTION A - Easy Windows setup (recommended)
     nexgen999 made two .bat files that install and run the resolver:
       https://github.com/nexgen999/PS5-Repository-List/tree/main/pegasus-resolver
     - Download installer_et_lancer_pegasus.bat and lancer_pegasus.bat
     - Edit both files and set your PC's local IP
     - Put them in  C:\Users\<your_username>\
     - First time: run installer_et_lancer_pegasus.bat
     - After that: just run lancer_pegasus.bat

   OPTION B - Official resolver (Linux / macOS / advanced)
     https://github.com/pegasus-ps5/pegasus-resolver
       git clone https://github.com/pegasus-ps5/pegasus-resolver.git
       cd pegasus-resolver
       python3 -m venv .venv
       . .venv/bin/activate            (Windows: .venv\Scripts\activate)
       python -m pip install -e .
       pegasus-resolver --host 0.0.0.0 --port 7799

3) POINT PEGASUS DL AT THE RESOLVER
   In Pegasus DL -> Settings -> Resolver URL:
       http://<your-pc-ip>:7799
   Save, then queue packages as normal. Direct links download without it.

   Test it: open http://127.0.0.1:7799/api/health in a browser.
   You should see JSON with status = ok.
"""


def _host_short(url: str) -> str:
    u = (url or "").lower()
    for needle, short in _HOST_SHORT:
        if needle in u:
            return short
    return "Link"


def _size_to_bytes(size_str: str) -> int | None:
    """'45GB' -> 48318382080 (binary GB). Returns None if unparseable."""
    if not size_str:
        return None
    m = re.search(r"([\d.]+)\s*(TB|GB|MB|KB)?", str(size_str), re.I)
    if not m:
        return None
    n = float(m.group(1))
    unit = (m.group(2) or "GB").upper()
    mult = {"KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3, "TB": 1024 ** 4}
    return int(n * mult.get(unit, 1024 ** 3))


def _build_description(game: dict, builds: list | None = None) -> str:
    """Clean, line-broken description. `builds` is an optional list of build
    label strings present in this package (e.g. ["Standard", "4.xx BackPort",
    "DLC"]) so the user can see at a glance what's bundled in the one tile."""
    lines = []

    if builds:
        lines.append("Builds: " + ", ".join(builds))

    tags = game.get("tags_raw") or []
    tag_bits = [str(t) for t in tags
                if not re.match(r"^[\d.]+\s*(TB|GB|MB)$", str(t), re.I)]
    if tag_bits:
        lines.append("Tags: " + ", ".join(tag_bits))

    size = game.get("size") or ""
    if size:
        lines.append("Size: " + str(size))

    creds = game.get("credits") or {}
    cred_bits = []
    if creds.get("files"):
        cred_bits.append("Files: " + creds["files"])
    if creds.get("backport"):
        cred_bits.append("Backport: " + creds["backport"])
    if creds.get("dlc"):
        cred_bits.append("DLC: " + creds["dlc"])
    if cred_bits:
        lines.append("Credits: " + "; ".join(cred_bits))

    return "\n".join(lines)


def _section_to_label(section_name: str) -> str:
    """Map a raw section key to a human package label + link-name prefix.

    Section keys come from the scraper as e.g. 'game', 'standard', 'backport',
    'backport_4.xx', 'backport_7.xx', 'dlcs', 'dump'.
    """
    n = (section_name or "").strip().lower()
    if n in ("game", ""):
        return ""           # plain game -> no prefix / no suffix
    if n == "standard":
        return "Standard"
    if n in ("backport", "bp"):
        return "BackPort"
    # Handle both 'backport_4.xx' and the abbreviated 'bp_4.xx' the scraper
    # produces when the site label is 'BP 4.XX' instead of 'BACKPORT 4.XX'.
    if n.startswith(("backport_", "backport ", "bp_", "bp ")):
        if n.startswith("backport"):
            rest = n[len("backport"):]
        else:
            rest = n[len("bp"):]
        rest = rest.strip(" _").replace("_", ".")
        rest = re.sub(r"\s+", ".", rest)
        return f"{rest} BackPort" if rest else "BackPort"
    if n in ("dlcs", "dlc"):
        return "DLC"
    if n == "dump":
        return "Dump"
    # Fallback: keep it readable but never produce mangled casing like 'Bp 4.Xx'
    return section_name.replace("_", " ").strip().title()


def _decrypt_links(records: list, password: str, name_prefix: str = "") -> list:
    """Turn a section's raw link records into Pegasus downloadLinks."""
    out = []
    for rec in records or []:
        raw = rec.get("locked_url") or rec.get("url") or ""
        if not raw:
            continue
        if is_link_lock_url(raw):
            real = decrypt_link_lock(raw, password)
        elif raw.startswith(("http://", "https://")):
            real = raw          # already a plain URL
        else:
            real = ""
        if not real:
            continue
        host = _host_short(real)
        name = f"{name_prefix} - {host}" if name_prefix else host
        out.append({"name": name, "url": real})
    return out


def _clean_ppsa(game: dict) -> str:
    """Extract a clean PPSA id. The stored field may already be clean, but
    some games carry a suffix in the tag (e.g. 'PPSA12562 - VR'). Fall back to
    scanning tags_raw if the ppsa field is empty or malformed."""
    raw = (game.get("ppsa") or "").strip().upper()
    m = re.search(r"PPSA\d{4,6}", raw)
    if m:
        return m.group(0)
    # fall back to tags
    for t in game.get("tags_raw") or []:
        m = re.search(r"PPSA\d{4,6}", str(t).upper())
        if m:
            return m.group(0)
    return "UNKNOWN"


def _parse_firmwares(game: dict) -> dict:
    """Pull firmware tiers from the game's backport_text / tags.

    Examples seen in the wild:
        'Standard (9.xx) + 4.xx BackPort'  -> std='9.xx', bp='4.xx'
        '4.xx and beyond'                  -> std='4.xx'
        '9.xx and beyond'                  -> std='9.xx'
    Returns {'standard': '9.xx'|'', 'backport': '4.xx'|''}.
    """
    txt = (game.get("backport_text") or "").strip()
    if not txt:
        for t in game.get("tags_raw") or []:
            ts = str(t)
            if re.search(r"\d\.x", ts, re.I) or "beyond" in ts.lower():
                txt = ts
                break
    std = bp = ""
    # Standard tier: the firmware inside "Standard (X.xx)" or a bare "X.xx and beyond"
    m = re.search(r"standard\s*\(?\s*(\d\.x{1,2})", txt, re.I)
    if m:
        std = m.group(1).lower()
    else:
        m2 = re.search(r"(\d\.x{1,2})\s*(?:and\s*beyond|\+\s*)?", txt, re.I)
        if m2 and "backpor" not in txt.lower()[:m2.start()]:
            std = m2.group(1).lower()
    # BackPort tier: the firmware just before "BackPort"/"BackPork"
    mb = re.search(r"(\d\.x{1,2})\s*backpor[kt]", txt, re.I)
    if mb:
        bp = mb.group(1).lower()
    return {"standard": std, "backport": bp}


def game_to_packages(game: dict, password: str) -> list:
    """Convert one stored game into a SINGLE Pegasus package containing every
    build's links (Standard / BackPort variants / DLC / Dump), each link named
    with its build so the one tile expands to show them all.

    Returns a list for backwards compatibility, but it now contains at most one
    package per game.
    """
    title = (game.get("title") or game.get("scraped_title") or "Unknown").strip()
    ppsa = _clean_ppsa(game)
    version = (game.get("version") or "").strip()
    poster = game.get("cover") or game.get("enrichment", {}).get("cover_url") or ""
    size_bytes = _size_to_bytes(game.get("size"))
    src_url = game.get("url") or ""

    sections = game.get("exfat_raw_sections") or {}

    # Split each section's records into the game-build bucket vs DLC bucket.
    dlc_records = []
    build_sections = {}     # section_name -> [records]
    for sec_name, recs in sections.items():
        plain, dlc = [], []
        for r in (recs or []):
            (dlc if r.get("is_dlc") else plain).append(r)
        if dlc:
            dlc_records.extend(dlc)
        if plain:
            build_sections.setdefault(sec_name, []).extend(plain)

    # Only sections that actually have links.
    real_builds = [(s, r) for s, r in build_sections.items()
                   if any((rr.get("locked_url") or rr.get("url")) for rr in r)]

    fw = _parse_firmwares(game)   # {'standard': '9.xx', 'backport': '4.xx'}

    has_backport = any(_section_to_label(s).endswith("BackPort")
                       for s, _ in real_builds)
    has_plain = any(_section_to_label(s) == "" for s, _ in real_builds)
    name_plain_as_standard = has_backport and has_plain

    def _with_fw(disp: str) -> str:
        """Append the firmware tier to a build label if we have it and it
        isn't already present, so link names read e.g. 'Standard 9.xx' and
        '4.xx BackPort'."""
        low = disp.lower()
        if "backport" in low:
            # already has a firmware prefix? (e.g. '4.xx BackPort')
            if re.match(r"\d\.x", disp):
                return disp
            return f"{fw['backport']} BackPort" if fw.get("backport") else disp
        if disp in ("Standard",):
            return f"Standard {fw['standard']}" if fw.get("standard") else disp
        return disp

    all_links = []
    build_labels = []        # for the description "Builds:" line

    # Order: plain/standard first, then backports, then dumps, then anything else
    def _order(item):
        lbl = _section_to_label(item[0])
        if lbl == "":
            return (0, "")
        if lbl == "Standard":
            return (1, "")
        if lbl.endswith("BackPort"):
            return (2, lbl)
        if lbl == "Dump":
            return (4, lbl)
        return (3, lbl)

    for sec_name, recs in sorted(real_builds, key=_order):
        label = _section_to_label(sec_name)
        if label == "":
            disp = "Standard" if name_plain_as_standard else "Game"
        else:
            disp = label
        disp = _with_fw(disp)
        # Prefix every link with its build so the single tile is self-explanatory.
        prefix = "" if disp == "Game" else disp
        links = _decrypt_links(recs, password, prefix)
        if links:
            all_links.extend(links)
            if disp not in build_labels:
                build_labels.append(disp)

    # DLC links fold into the SAME package, prefixed "DLC".
    if dlc_records:
        dlc_links = _decrypt_links(dlc_records, password, "DLC")
        if dlc_links:
            all_links.extend(dlc_links)
            if "DLC" not in build_labels:
                build_labels.append("DLC")

    if not all_links:
        return []

    # Category is "dlc" only if the game is purely DLC with no game build.
    only_dlc = bool(dlc_records) and not real_builds
    pkg = {
        "titleId": ppsa,
        "title": title,
        "version": version,
        "category": "dlc" if only_dlc else "game",
        "posterUrl": poster,
        "description": _build_description(
            game, builds=build_labels if len(build_labels) > 1 or
            (build_labels and build_labels[0] not in ("Game",)) else None),
        "downloadSource": src_url,
        "downloadLinks": all_links,
        "sizeBytes": size_bytes,
    }
    return [pkg]


def build_pegasus_catalog(games: list, password: str,
                          name: str = "exFAT Ripper") -> dict:
    """Build the full Pegasus catalog dict from the library."""
    packages = []
    for g in games:
        try:
            packages.extend(game_to_packages(g, password))
        except Exception:
            # never let one bad game abort the whole export
            continue
    return {
        "name": name,
        "version": 1,
        "packages": packages,
        "_generated": datetime.datetime.now(datetime.timezone.utc)
                        .isoformat().replace("+00:00", "Z"),
        "_stats": {
            "totalItems": len(games),
            "totalPackages": len(packages),
        },
    }


SOURCE_NAME = "exFAT Ripper"


def merge_pegasus_config(existing_config, catalog: dict, now: int) -> dict:
    """Pure merge helper — no FTP, fully unit-testable.

    Takes whatever was read from the PS5's /data/pegasus-dl/config.json
    (which may be None, malformed, or a valid dict) and returns a new config
    dict with the "exFAT Ripper" source's catalog replaced/inserted, preserving
    every other top-level key and every other source.

    Rules:
      - None / non-dict / missing "sources"      -> start from a fresh default.
      - "sources" present but not a list          -> normalise just that to [].
      - Existing "exFAT Ripper" source            -> replace its catalog +
                                                     bump lastRefreshAt (no dup).
      - No "exFAT Ripper" source                  -> append one.
      - All other top-level keys & other sources  -> preserved untouched.
    """
    fresh_default = {
        "version": 1,
        "downloadRoot": "/data/pegasus-dl/downloads",
        "downloadConnections": 4,
        "sources": [],
    }

    if not isinstance(existing_config, dict) or "sources" not in existing_config:
        config = dict(fresh_default)
        config["_created_fresh"] = True
    else:
        # Work on a shallow copy so we don't mutate the caller's object.
        config = dict(existing_config)
        config["_created_fresh"] = False

    sources = config.get("sources")
    if not isinstance(sources, list):
        sources = []
    else:
        sources = list(sources)  # copy so we don't mutate the original list
    config["sources"] = sources

    entry = None
    for i, s in enumerate(sources):
        if isinstance(s, dict) and s.get("name") == SOURCE_NAME:
            entry = dict(s)          # copy the matched source
            sources[i] = entry
            break

    if entry is None:
        entry = {"name": SOURCE_NAME, "kind": "upload", "enabled": True}
        sources.append(entry)

    entry.setdefault("kind", "upload")
    entry["enabled"] = True
    entry["lastRefreshAt"] = now
    entry["catalog"] = catalog

    return config
