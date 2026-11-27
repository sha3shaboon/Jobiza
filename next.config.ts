import type { NextConfig } from "next";

// ONNX runtime ships binaries for every OS; keep only the one this build runs on
// (Linux for Docker, Windows for the desktop installer).
const os = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
const otherOses = ["linux", "darwin", "win32"].filter((o) => o !== os);
const ortDir = `./node_modules/onnxruntime-node/bin/napi-v*/${os}`;
// Only the CPU runtime: the GPU providers are hundreds of MB.
const ortFiles = {
  linux: [`${ortDir}/*/onnxruntime_binding.node`, `${ortDir}/*/libonnxruntime.so*`, `${ortDir}/*/libonnxruntime_providers_shared.so`],
  darwin: [`${ortDir}/*/onnxruntime_binding.node`, `${ortDir}/*/libonnxruntime*.dylib`],
  // onnxruntime.dll is built with DirectML, so it needs the DirectX DLLs next to it.
  win32: [`${ortDir}/x64/*`],
}[os];

const nextConfig: NextConfig = {
  output: "standalone",
  // Native/ML packages load at runtime instead of being bundled.
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "onnxruntime-web",
    "sharp",
    "unpdf",
    "pdfjs-dist",
    "pdfmake",
    "@citation-js/core",
    "@citation-js/plugin-csl",
    "@citation-js/plugin-bibtex",
    "@citation-js/plugin-ris",
    // Embedded Postgres for the desktop app (loads its WASM files from disk).
    "@electric-sql/pglite",
    "@electric-sql/pglite-pgvector",
  ],
  // transformers.js loads its native ONNX runtime dynamically, so tracing misses it.
  outputFileTracingIncludes: {
    // Citation styles are read from disk; PDF export reads pdfmake's bundled fonts.
    "/api/v1/**": ["./src/lib/writing/csl/*", "./node_modules/pdfmake/build/fonts/Roboto/*"],
    "/api/v1/conversations/\\[id\\]/messages": [
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**/*",
      ...ortFiles,
      "./node_modules/onnxruntime-common/**/*",
      "./node_modules/sharp/**/*",
      `./node_modules/@img/sharp-*${os}*/**/*`,
    ],
    // Desktop app: embedded Postgres (WASM + extensions) and the SQL migrations it applies at start-up.
    "/api/desktop/**": [
      "./node_modules/@electric-sql/pglite/dist/**/*",
      "./node_modules/@electric-sql/pglite-pgvector/dist/**/*",
      "./drizzle/**/*",
    ],
  },
  // CPU-only servers: skip the GPU providers (~270 MB).
  outputFileTracingExcludes: {
    "/**": [
      "./node_modules/onnxruntime-node/bin/**/libonnxruntime_providers_cuda.so",
      "./node_modules/onnxruntime-node/bin/**/libonnxruntime_providers_tensorrt.so",
      ...otherOses.map((o) => `./node_modules/onnxruntime-node/bin/napi-v*/${o}/**/*`),
      // The Windows installer targets x64 only.
      "./node_modules/onnxruntime-node/bin/napi-v*/win32/arm64/**/*",
      "./node_modules/@electric-sql/pglite/dist/**/*.map",
      // The WebAssembly ONNX runtime is only for Android, whose build script adds the files it needs.
      "./node_modules/onnxruntime-web/**/*",
    ],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
