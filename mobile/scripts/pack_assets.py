"""Packs the server and model into the APK's assets.

Android assets can't hold symlinks (Next.js's standalone build has a few), so
they're listed in symlinks.json and recreated on the phone. A version stamp
lets the app re-extract only when the bundle changes.
Run after prepare-server.mjs. Output: android/app/src/main/assets/{server,models}.zip, bundle.json
"""
import hashlib
import json
import os
import sys
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
mobile = os.path.dirname(here)
build = os.path.join(mobile, "build")
assets = os.path.join(mobile, "android", "app", "src", "main", "assets")
os.makedirs(assets, exist_ok=True)

stamp = hashlib.sha256()


def pack(src_dir: str, zip_name: str) -> None:
    links = {}
    dest = os.path.join(assets, zip_name)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for root, dirs, files in os.walk(src_dir, followlinks=False):
            dirs.sort()
            for name in sorted(dirs + files):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, src_dir).replace(os.sep, "/")
                if os.path.islink(full):
                    links[rel] = os.readlink(full)
                    if name in dirs:
                        dirs.remove(name)
                elif os.path.isfile(full):
                    z.write(full, rel)
                    stamp.update(rel.encode())
                    stamp.update(str(os.path.getsize(full)).encode())
        z.writestr("symlinks.json", json.dumps(links))
    print(f"{zip_name}: {os.path.getsize(dest) / 1e6:.0f} MB, {len(links)} symlinks")


if not os.path.exists(os.path.join(build, "server", "server.js")):
    sys.exit("Run `npm run prepare-server` first.")
pack(os.path.join(build, "server"), "server.zip")
pack(os.path.join(build, "models"), "models.zip")
with open(os.path.join(assets, "bundle.json"), "w") as f:
    json.dump({"version": stamp.hexdigest()[:16]}, f)
