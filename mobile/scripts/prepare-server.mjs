// Assembles the server the Android app runs: the Next.js standalone build
// (repo root `npm run build`), with native-only packages swapped for the
// WebAssembly ONNX runtime, plus the embedding model.
// Output: mobile/build/server and mobile/build/models.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, "..");
const root = path.resolve(mobile, "..");
const standalone = path.join(root, ".next", "standalone");
const out = path.join(mobile, "build");
const server = path.join(out, "server");
const models = path.join(out, "models");
const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";

const copy = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: true });
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const write = (p, text) => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, text));

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build found. Run `npm run build` in the repository root first.");
  process.exit(1);
}

// 1. The server, without stray local files.
rm(server);
fs.mkdirSync(server, { recursive: true });
for (const entry of ["server.js", "package.json", ".next", "node_modules", "drizzle", "src"]) {
  const from = path.join(standalone, entry);
  if (fs.existsSync(from)) copy(from, path.join(server, entry));
}
copy(path.join(root, ".next", "static"), path.join(server, ".next", "static"));
copy(path.join(root, "public"), path.join(server, "public"));
copy(path.join(root, "desktop", "server-entry.cjs"), path.join(server, "server-entry.cjs"));
for (const f of fs.readdirSync(server)) if (f.startsWith(".env")) rm(path.join(server, f));

// Next's standalone output links some packages (.next/node_modules/<name>-<hash>) to
// absolute paths on the build machine. Point them inside this bundle instead
// (relative links, recreated on the phone from symlinks.json).
function relativizeLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = path.resolve(dir, fs.readlinkSync(p));
      const rel = path.relative(standalone, target);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        // Outside the build: bring a real copy in.
        rm(p);
        copy(target, p);
      } else {
        rm(p);
        fs.symlinkSync(path.relative(dir, path.join(server, rel)), p);
      }
    } else if (entry.isDirectory()) {
      relativizeLinks(p);
    }
  }
}
relativizeLinks(server);


// 2. Native packages have no Android builds. transformers.js imports both at load
//    time, so they become stand-ins; embeddings run on onnxruntime-web instead.
const nm = path.join(server, "node_modules");
rm(path.join(nm, "onnxruntime-node"));
write(path.join(nm, "onnxruntime-node", "package.json"), JSON.stringify({ name: "onnxruntime-node", version: "0.0.0-android-stub", main: "index.js" }));
write(path.join(nm, "onnxruntime-node", "index.js"), "// Android: the WebAssembly runtime (onnxruntime-web) is used instead.\nmodule.exports = {};\n");
rm(path.join(nm, "sharp"));
rm(path.join(nm, "@img"));
write(path.join(nm, "sharp", "package.json"), JSON.stringify({ name: "sharp", version: "0.0.0-android-stub", main: "index.js" }));
write(
  path.join(nm, "sharp", "index.js"),
  "// Android: image processing isn't used by Jobiza's text embeddings.\nmodule.exports = function sharp() { throw new Error('sharp is not available on Android'); };\nmodule.exports.default = module.exports;\n",
);
const ortWeb = path.join(root, "node_modules", "onnxruntime-web");
const ortOut = path.join(nm, "onnxruntime-web");
rm(ortOut);
write(path.join(ortOut, "package.json"), fs.readFileSync(path.join(ortWeb, "package.json")));
for (const f of ["ort.node.min.js", "ort.node.min.mjs", "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
  copy(path.join(ortWeb, "dist", f), path.join(ortOut, "dist", f));
}
// Source maps and other OSes' binaries are dead weight on a phone.
for (const f of fs.readdirSync(nm, { recursive: true })) {
  const p = path.join(nm, String(f));
  if (String(f).endsWith(".map") && fs.existsSync(p)) rm(p);
}

// 3. The embedding model, so the library works offline from the first launch.
const cached = path.join(root, "data", "models", EMBEDDING_MODEL);
const desktopModels = path.join(root, "desktop", "build", "models", EMBEDDING_MODEL);
if (!fs.existsSync(path.join(models, EMBEDDING_MODEL))) {
  const from = [cached, desktopModels].find((p) => fs.existsSync(p));
  fs.mkdirSync(models, { recursive: true });
  if (from) {
    copy(from, path.join(models, EMBEDDING_MODEL));
  } else {
    console.info(`Downloading ${EMBEDDING_MODEL}…`);
    const script = `
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = ${JSON.stringify(models)};
      const pipe = await pipeline("feature-extraction", ${JSON.stringify(EMBEDDING_MODEL)}, { dtype: "q8" });
      await pipe("warm up", { pooling: "cls", normalize: true });
    `;
    execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, stdio: "inherit" });
  }
}

const size = (dir) => fs.readdirSync(dir, { recursive: true }).reduce((n, f) => n + (fs.lstatSync(path.join(dir, String(f))).isFile() ? fs.lstatSync(path.join(dir, String(f))).size : 0), 0);
console.info(`server: ${(size(server) / 1e6).toFixed(0)} MB, models: ${(size(models) / 1e6).toFixed(0)} MB`);
