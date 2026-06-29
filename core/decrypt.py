"""
core/decrypt.py
---------------
Offline Link Lock decryption. The .exFAT site wraps every download link in an
AES-GCM ciphertext, key derived via PBKDF2-HMAC-SHA256. The locked URL is read
straight from exFAT.json; this module turns it into the real download URL with
no browser, instantly.

pippo's link-lock format has two generations and this module handles both:
  • Legacy: /link-lock-pippo/#<b64 {e,s,i}>, 100k iterations, salt+iv always
    present.
  • Current: /library-decrypt/decrypt-public.html#<b64 {v,e[,s][,i],n}>,
    600k iterations, "compact" payload where the salt and/or iv are OMITTED
    when they are the all-zero default. The decrypted plaintext is JSON
    {"v":..,"u":"<real url>"} rather than a bare URL.
"""
from __future__ import annotations

import base64
import json

from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Iteration counts to try, newest first. pippo bumped 100k -> 600k.
PBKDF2_ITERATION_CANDIDATES = (600_000, 100_000)

# Base64 of the all-zero default salt (16 bytes) / iv (12 bytes) the compact
# format uses as sentinels for "omitted".
_ZERO_SALT_B64 = "AAAAAAAAAAAAAAAAAAAAAA"   # 16 zero bytes
_ZERO_IV_B64 = "AAAAAAAAAAAAAAAA"            # 12 zero bytes (not relied on; we
                                            # just treat a missing iv as zeros)

# Cache so repeated identical locked URLs only decrypt once per session.
_cache: dict[tuple[str, str], str] = {}


def is_link_lock_url(url: str) -> bool:
    u = url or ""
    if "#" not in u:
        return False
    return ("link-lock" in u) or ("library-decrypt" in u) or \
           ("decrypt-public" in u)


def _b64d(s: str) -> bytes:
    s = (s or "").replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)            # restore base64 padding
    return base64.b64decode(s)


def decrypt_link_lock(url: str, password: str) -> str:
    """Decrypt a link-lock URL -> the original destination URL.
    Returns '' on any failure (wrong password, malformed fragment)."""
    if not is_link_lock_url(url):
        return ""
    ckey = (url, password)
    if ckey in _cache:
        return _cache[ckey]

    result = ""
    try:
        frag = url.split("#", 1)[1].strip()
        payload = json.loads(_b64d(frag))

        e = _b64d(payload["e"])                      # ciphertext + GCM tag

        # Salt: present & non-default -> use it; otherwise 16 zero bytes.
        s_b64 = payload.get("s")
        salt = _b64d(s_b64) if (s_b64 and s_b64 != _ZERO_SALT_B64) else bytes(16)

        # IV: present & non-default -> use it; otherwise 12 zero bytes.
        i_b64 = payload.get("i")
        iv = _b64d(i_b64) if i_b64 else bytes(12)

        pwd = password.encode("utf-8")
        plaintext = None
        for iters in PBKDF2_ITERATION_CANDIDATES:
            try:
                kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                                 salt=salt, iterations=iters)
                key = kdf.derive(pwd)
                plaintext = AESGCM(key).decrypt(iv, e, None)
                break                                 # success -> stop trying
            except Exception:
                continue

        if plaintext is not None:
            text = plaintext.decode("utf-8", errors="replace").strip()
            # Current format wraps the URL as JSON {"v":..,"u":"<url>"}.
            if text.startswith("{"):
                try:
                    obj = json.loads(text)
                    text = (obj.get("u") or obj.get("url") or "").strip()
                except Exception:
                    pass
            result = text
    except Exception:
        result = ""

    _cache[ckey] = result
    return result


# Host classification from a resolved URL.
_HOST_KEYS = [
    ("akirabox.",   "akirabox"),
    ("datanodes.",  "datanodes"),
    ("vikingfile.", "vikingfile"),
    ("vik1ngfile.", "vikingfile"),
    ("filekeeper.", "filekeeper"),
    ("datavault",   "datavault"),
    ("buzzheavier", "buzzheavier"),
    ("mediafire.",  "mediafire"),
    ("1fichier.",   "1fichier"),
    ("pixeldrain.", "pixeldrain"),
    ("gofile.",     "gofile"),
    ("mega.",       "mega"),
    ("rapidgator.", "rapidgator"),
    ("rootz.",      "rootz"),
]


def host_for(url: str) -> str:
    u = (url or "").lower()
    for needle, key in _HOST_KEYS:
        if needle in u:
            return key
    return "other"


def resolve_game_links(game: dict, password: str) -> dict:
    """Given a game dict with `exfat_raw_sections` holding locked URLs,
    decrypt every link and return a structure ready for the UI:

        {
          "sections": {
             "GAME":     [{"host","url","is_dlc","is_dump"}, ...],
             "BACKPORT": [...],
             "DLC":      [...],
             ...
          }
        }
    """
    raw = game.get("exfat_raw_sections") or {}
    out: dict[str, list[dict]] = {}

    def label_of(sec_name: str) -> str:
        n = (sec_name or "").lower()
        if n in ("game", "standard", ""):
            return "GAME"
        if n.startswith("backport") or n.startswith("bp_") or n.startswith("bp-"):
            return "BACKPORT"
        if "dlc" in n:
            return "DLC"
        if "dump" in n:
            return "DUMP"
        if "fix" in n or "patch" in n:
            return "FIX"
        if "update" in n:
            return "UPDATE"
        return "OTHER"

    for sec_name, recs in raw.items():
        if not isinstance(recs, list):
            continue
        for r in recs:
            base = label_of(sec_name)
            if r.get("is_dlc"):
                base = "DLC"
            if r.get("is_dump"):
                base = "DUMP"
            locked = r.get("locked_url", "")
            # Prefer a fresh offline decrypt; fall back to any stored resolved.
            url = decrypt_link_lock(locked, password) or r.get("resolved_url", "")
            if not url:
                continue
            out.setdefault(base, []).append({
                "host": host_for(url),
                "url": url,
                "label": r.get("label", ""),
                "is_dlc": bool(r.get("is_dlc")),
                "is_dump": bool(r.get("is_dump")),
            })

    # Convert the {LABEL: [links]} map into the {regions, builds} structure
    # the UI's detail panel expects, so every source feeds renderLinks an
    # identical structure.
    return _to_regions(game, out)


# Section ordering for a tidy detail panel.
_SECTION_ORDER = ["GAME", "BACKPORT", "DLC", "DUMP", "UPDATE", "FIX", "OTHER"]


def _to_regions(game: dict, sections: dict) -> dict:
    """Wrap an exFAT {LABEL: [links]} map as the regions/builds structure.

    exFAT games have no per-region packages, so the result is a single
    region whose builds are the GAME / BACKPORT / DLC / ... sections, each
    with its links grouped by host.
    """
    def build_title(label: str) -> str:
        v = (game.get("version") or "").strip()
        if label == "GAME":
            return f"Game ({v})" if v else "Game"
        if label == "BACKPORT":
            bp = game.get("backport") or {}
            fw = (bp.get("firmware") or "").strip()
            grp = (bp.get("release_group") or "").strip()
            t = "Backport"
            if fw:
                t += f" {fw}"
            if grp:
                t += f" (@{grp.lstrip('@')})"
            return t
        return label.title()

    builds = []
    ordered = sorted(
        sections.keys(),
        key=lambda k: _SECTION_ORDER.index(k) if k in _SECTION_ORDER else 99)
    for label in ordered:
        links = sections[label]
        if not links:
            continue
        # group this section's links by host
        by_host: dict[str, list[dict]] = {}
        for ln in links:
            by_host.setdefault(ln["host"], []).append(ln)
        hosts = []
        for host, items in by_host.items():
            hosts.append({
                "host": host,
                "links": [{"url": it["url"], "part": i + 1}
                          for i, it in enumerate(items)],
            })
        builds.append({
            "kind": label,
            "title": build_title(label),
            "version": game.get("version", "") or "",
            "firmware": "",
            "release_group": "",
            "hosts": hosts,
        })

    if not builds:
        return {"regions": [], "multi_region": False}

    return {
        "regions": [{
            "ppsa": (game.get("ppsa") or "").strip(),
            "region": (game.get("region") or "").strip(),
            "label": (game.get("ppsa") or "Download").strip(),
            "info": {
                "size": game.get("size", "") or "",
                "release_group": (game.get("credits") or {}).get("files", "")
                if isinstance(game.get("credits"), dict) else "",
            },
            "builds": builds,
        }],
        "multi_region": False,
    }
