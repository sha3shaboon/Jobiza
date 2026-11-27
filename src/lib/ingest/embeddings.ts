import path from "node:path";
import { env as appEnv } from "../env";

/**
 * Local embeddings with transformers.js (ONNX, CPU). Model: BAAI bge-small-en-v1.5,
 * 384 dimensions, downloaded once into MODEL_CACHE_DIR. No API key or cost.
 */
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

type Extractor = (texts: string[], opts: { pooling: "cls"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

const g = globalThis as unknown as { __jobizaEmbedder?: Promise<Extractor> };

/**
 * Where there's no native ONNX runtime (Android), run the same model on the
 * WebAssembly build. Results match the native runtime to ~0.999 cosine, so
 * vectors from either can be mixed (and synced between devices).
 */
const useWasm = () => process.env.JOBIZA_ONNX === "wasm" || process.platform === "android";

async function useWasmRuntime() {
  // Must be registered before transformers.js loads: it checks for this symbol first.
  const key = Symbol.for("onnxruntime");
  const glob = globalThis as unknown as Record<symbol, unknown>;
  if (glob[key]) return;
  const ort = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "onnxruntime-web");
  // The server runs from its own folder (standalone or dev); the bundler would rewrite require.resolve.
  const dir = path.join(process.cwd(), "node_modules", "onnxruntime-web", "dist", path.sep);
  ort.env.wasm.wasmPaths = dir;
  ort.env.wasm.numThreads = 1;
  glob[key] = ort;
}

async function extractor(): Promise<Extractor> {
  if (!g.__jobizaEmbedder) {
    g.__jobizaEmbedder = (async () => {
      const wasm = useWasm();
      if (wasm) await useWasmRuntime();
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = appEnv().MODEL_CACHE_DIR;
      // With an injected runtime, "auto" lets it pick its WebAssembly backend.
      const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8", ...(wasm ? { device: "auto" as const } : {}) });
      return pipe as unknown as Extractor;
    })();
    g.__jobizaEmbedder.catch(() => {
      g.__jobizaEmbedder = undefined; // allow a retry after a failed download
    });
  }
  return g.__jobizaEmbedder;
}

export async function embedDocuments(texts: string[], batchSize = 16): Promise<number[][]> {
  const run = await extractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = await run(texts.slice(i, i + batchSize), { pooling: "cls", normalize: true });
    out.push(...batch.tolist());
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const run = await extractor();
  const [vector] = (await run([QUERY_PREFIX + text], { pooling: "cls", normalize: true })).tolist();
  return vector;
}
