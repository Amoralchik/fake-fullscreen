#!/usr/bin/env python3
"""
Build store-ready packages for each browser family (pure stdlib).

The repo-root manifest.json loads unpacked in BOTH Firefox/Zen and
Chromium (Chrome, Brave, Edge, …) for development: it declares the
background twice ("scripts" for Firefox, "service_worker" for Chromium)
and each browser ignores the key it doesn't use. Stores are pickier, so
this script writes a tailored manifest per target:

  dist/firefox/   + dist/fake-fullscreen-<ver>-firefox.zip   → AMO
      background.scripts only, browser_specific_settings kept
  dist/chromium/  + dist/fake-fullscreen-<ver>-chromium.zip  → Chrome Web Store / Edge Add-ons
      background.service_worker only, no browser_specific_settings,
      minimum_chrome_version 121
  dist/SHA256SUMS.txt                                         → release checksums

GitHub Releases: pushing a vX.Y.Z tag runs .github/workflows/release.yml,
which runs this script and attaches the zips + checksums to the release.

Run:  python3 tools/build.py
"""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

FILES = [
    "background.js", "content.js", "content.css", "injected.js",
    "popup.html", "popup.js", "options.html", "options.js", "LICENSE",
]
DIRS = ["icons"]


def firefox(m):
    m["background"] = {"scripts": [m["background"]["service_worker"]]}
    return m


def chromium(m):
    m.pop("browser_specific_settings", None)
    m["background"] = {"service_worker": m["background"]["service_worker"]}
    # world:"MAIN" content scripts → 111; background scripts+service_worker
    # tolerance and popover API are older than this.
    m["minimum_chrome_version"] = "121"
    return m


def build(name, transform, base):
    out = DIST / name
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for f in FILES:
        shutil.copy2(ROOT / f, out / f)
    for d in DIRS:
        shutil.copytree(ROOT / d, out / d)
    manifest = transform(json.loads(json.dumps(base)))
    (out / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    archive = DIST / f"fake-fullscreen-{base['version']}-{name}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(out.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(out).as_posix())  # manifest.json at zip root
    print(f"{name:9} -> {archive.relative_to(ROOT)}")
    return archive


def main():
    base = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    archives = [build("firefox", firefox, base), build("chromium", chromium, base)]
    # Checksums for the release page (sha256sum -c SHA256SUMS.txt).
    sums = "".join(
        f"{hashlib.sha256(a.read_bytes()).hexdigest()}  {a.name}\n" for a in archives)
    (DIST / "SHA256SUMS.txt").write_text(sums, encoding="utf-8")
    print("checksums -> dist/SHA256SUMS.txt")


if __name__ == "__main__":
    main()
