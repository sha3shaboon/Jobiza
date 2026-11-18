import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native/ML packages load at runtime instead of being bundled.
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
    "unpdf",
    "pdfjs-dist",
    "pdfmake",
    "@citation-js/core",
    "@citation-js/plugin-csl",
    "@citation-js/plugin-bibtex",
    "@citation-js/plugin-ris",
  ],
  // transformers.js loads its native ONNX runtime dynamically, so tracing misses it.
  outputFileTracingIncludes: {
    // Citation styles are read from disk; PDF export reads pdfmake's bundled fonts.
    "/api/v1/**": ["./src/lib/writing/csl/*", "./node_modules/pdfmake/build/fonts/Roboto/*"],
    "/api/v1/conversations/\\[id\\]/messages": [
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/*/onnxruntime_binding.node",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/*/libonnxruntime.so*",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/*/libonnxruntime_providers_shared.so",
      "./node_modules/onnxruntime-common/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/@img/sharp-*linux*/**/*",
    ],
  },
  // CPU-only servers: skip the GPU providers (~270 MB).
  outputFileTracingExcludes: {
    "/**": [
      "./node_modules/onnxruntime-node/bin/**/libonnxruntime_providers_cuda.so",
      "./node_modules/onnxruntime-node/bin/**/libonnxruntime_providers_tensorrt.so",
      "./node_modules/onnxruntime-node/bin/napi-v*/darwin/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v*/win32/**/*",
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
