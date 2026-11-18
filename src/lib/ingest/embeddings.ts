import { env as appEnv } from "../env";

/**
 * Local embeddings with transformers.js (ONNX, CPU). Model: BAAI bge-small-en-v1.5,
 * 384 dimensions, downloaded once into MODEL_CACHE_DIR. No API key or cost.
 */
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

type Extractor = (texts: string[], opts: { pooling: "cls"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

const g = globalThis as unknown as { __jobizaEmbedder?: Promise<Extractor> };

async function extractor(): Promise<Extractor> {
  if (!g.__jobizaEmbedder) {
    g.__jobizaEmbedder = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = appEnv().MODEL_CACHE_DIR;
      const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
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
