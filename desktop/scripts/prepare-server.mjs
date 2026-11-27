// Assembles what the desktop app runs: the Next.js standalone server (built at
// the repo root with `npm run build`) and the local embedding model.
// Output: desktop/build/server and desktop/build/models.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const root = path.resolve(desktop, "..");
const standalone = path.join(root, ".next", "standalone");
const out = path.join(desktop, "build");
const server = path.join(out, "server");
const models = path.join(out, "models");

const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";

function copy(from, to) {
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build found. Run `npm run build` in the repository root first.");
  process.exit(1);
}

// 1. Server: copy only what it needs (never stray local files such as .env or database dumps).
fs.rmSync(server, { recursive: true, force: true });
fs.mkdirSync(server, { recursive: true });
for (const entry of ["server.js", "package.json", ".next", "node_modules", "drizzle", "src"]) {
  const from = path.join(standalone, entry);
  if (fs.existsSync(from)) copy(from, path.join(server, entry));
}
copy(path.join(root, ".next", "static"), path.join(server, ".next", "static"));
copy(path.join(root, "public"), path.join(server, "public"));
copy(path.join(desktop, "server-entry.cjs"), path.join(server, "server-entry.cjs"));
for (const f of fs.readdirSync(server)) if (f.startsWith(".env")) fs.rmSync(path.join(server, f));

// Next's standalone output links some packages (.next/node_modules/<name>-<hash>) to
// absolute paths on the build machine. Replace each link with a real copy of the
// package inside this bundle; Windows installers can't carry symlinks reliably.
function materializeLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = path.resolve(dir, fs.readlinkSync(p));
      const rel = path.relative(standalone, target);
      const inBundle = !rel.startsWith("..") && !path.isAbsolute(rel) ? path.join(server, rel) : target;
      fs.rmSync(p, { force: true });
      fs.cpSync(inBundle, p, { recursive: true, dereference: true });
    } else if (entry.isDirectory()) {
      materializeLinks(p);
    }
  }
}
materializeLinks(server);

// The production server never reads source maps.
for (const dir of [path.join(server, "node_modules", "@electric-sql")]) {
  for (const f of fs.readdirSync(dir, { recursive: true })) if (String(f).endsWith(".map")) fs.rmSync(path.join(dir, String(f)));
}

// 2. Embedding model, so the library works offline from the first launch.
const cached = path.join(root, "data", "models", EMBEDDING_MODEL);
if (!fs.existsSync(path.join(models, EMBEDDING_MODEL))) {
  fs.mkdirSync(models, { recursive: true });
  if (fs.existsSync(cached)) {
    copy(cached, path.join(models, EMBEDDING_MODEL));
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

const size = (dir) => fs.readdirSync(dir, { recursive: true }).reduce((n, f) => n + (fs.statSync(path.join(dir, String(f))).isFile() ? fs.statSync(path.join(dir, String(f))).size : 0), 0);
console.info(`server: ${(size(server) / 1e6).toFixed(0)} MB, models: ${(size(models) / 1e6).toFixed(0)} MB`);
