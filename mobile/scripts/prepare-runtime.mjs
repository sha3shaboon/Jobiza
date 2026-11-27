// Fetches Node.js for Android from Termux's package repository (arm64 phones and
// x86_64 emulators/Chromebooks) and packs it as native libraries the app can run:
// Android only installs and allows executing files named lib*.so from the APK.
// Output: android/app/src/main/jniLibs/<abi>/libnode.so plus its shared libraries.
// Needs: ar, tar (xz), readelf, patchelf (pip install patchelf).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, "..");
const cache = path.join(mobile, "build", "termux");
const jniLibs = path.join(mobile, "android", "app", "src", "main", "jniLibs");
const REPO = "https://packages.termux.dev/apt/termux-main";
const ROOT_PACKAGE = "nodejs-lts";
const ABIS = { "arm64-v8a": "aarch64", x86_64: "x86_64" };
// Provided by Android itself; never bundled.
const SYSTEM_LIBS = new Set(["libc.so", "libm.so", "libdl.so", "liblog.so", "libandroid.so", "libz.so"]);

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts });

async function download(url, file) {
  if (fs.existsSync(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function parseIndex(text) {
  const pkgs = new Map();
  for (const block of text.split("\n\n")) {
    const f = Object.fromEntries(block.split("\n").filter((l) => /^[A-Za-z0-9-]+: /.test(l)).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)]));
    if (f.Package) pkgs.set(f.Package, f);
  }
  return pkgs;
}

/** The package and everything it depends on (names only; Termux pins no versions that matter here). */
function closure(pkgs, name, seen = new Set()) {
  if (seen.has(name)) return seen;
  const p = pkgs.get(name);
  if (!p) throw new Error(`Package ${name} not found in the Termux index`);
  seen.add(name);
  for (const dep of (p.Depends ?? "").split(",").map((d) => d.trim().split(/[\s(|]/)[0]).filter(Boolean)) closure(pkgs, dep, seen);
  return seen;
}

/** jniLibs only accepts lib*.so: libssl.so.3 → libssl_so_3.so */
const jniName = (soname) => (soname.endsWith(".so") ? soname : soname.replace(/\.so\.(.+)$/, (_, v) => `_so_${v.replace(/\./g, "_")}.so`));

const needed = (file) =>
  run("readelf", ["-d", file])
    .split("\n")
    .map((l) => l.match(/\(NEEDED\).*\[(.+)\]/)?.[1])
    .filter(Boolean);

for (const [abi, arch] of Object.entries(ABIS)) {
  const indexFile = path.join(cache, arch, "Packages");
  await download(`${REPO}/dists/stable/main/binary-${arch}/Packages`, indexFile);
  const pkgs = parseIndex(fs.readFileSync(indexFile, "utf8"));
  const names = [...closure(pkgs, ROOT_PACKAGE)];
  const prefix = path.join(cache, arch, "root");
  fs.rmSync(prefix, { recursive: true, force: true });
  fs.mkdirSync(prefix, { recursive: true });

  for (const name of names) {
    const p = pkgs.get(name);
    const deb = path.join(cache, arch, path.basename(p.Filename));
    await download(`${REPO}/${p.Filename}`, deb);
    const sha = createHash("sha256").update(fs.readFileSync(deb)).digest("hex");
    if (sha !== p.SHA256) throw new Error(`Checksum mismatch for ${p.Filename}`);
    const work = fs.mkdtempSync(path.join(cache, arch, "deb-"));
    run("ar", ["x", deb], { cwd: work });
    const data = fs.readdirSync(work).find((f) => f.startsWith("data.tar"));
    run("tar", ["-xf", path.join(work, data), "-C", prefix]);
    fs.rmSync(work, { recursive: true, force: true });
  }

  const usr = path.join(prefix, "data", "data", "com.termux", "files", "usr");
  const node = path.join(usr, "bin", "node");
  const libDir = path.join(usr, "lib");
  const out = path.join(jniLibs, abi);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // Walk the dependency graph from node, bundling every library Termux provides.
  const bundled = new Map(); // soname -> source path
  const queue = [node];
  while (queue.length) {
    for (const soname of needed(queue.shift())) {
      if (bundled.has(soname) || SYSTEM_LIBS.has(soname)) continue;
      const src = path.join(libDir, soname);
      if (!fs.existsSync(src)) throw new Error(`${abi}: ${soname} isn't in Termux's lib folder or Android's system libraries`);
      bundled.set(soname, fs.realpathSync(src));
      queue.push(fs.realpathSync(src));
    }
  }

  const rename = (file, isLib, soname) => {
    for (const dep of needed(file)) if (bundled.has(dep) && jniName(dep) !== dep) run("patchelf", ["--replace-needed", dep, jniName(dep), file]);
    if (isLib && jniName(soname) !== soname) run("patchelf", ["--set-soname", jniName(soname), file]);
    run("patchelf", ["--remove-rpath", file]);
  };
  fs.copyFileSync(node, path.join(out, "libnode.so"));
  rename(path.join(out, "libnode.so"), false);
  for (const [soname, src] of bundled) {
    const dest = path.join(out, jniName(soname));
    fs.copyFileSync(src, dest);
    rename(dest, true, soname);
  }
  const version = pkgs.get(ROOT_PACKAGE).Version;
  const total = fs.readdirSync(out).reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
  console.info(`${abi}: Node ${version} + ${bundled.size} libraries (${(total / 1e6).toFixed(0)} MB) from ${names.length} Termux packages`);
}
