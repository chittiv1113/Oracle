/**
 * Text embedding generator using HuggingFace Transformers.js.
 *
 * Provides CPU-based semantic embeddings for vector search using the
 * bge-small-en-v1.5 model (384 dimensions, optimized for CPU inference).
 *
 * CRITICAL: All embeddings are normalized for cosine similarity search.
 * Model downloads once (~50MB) then caches to .oracle/models/.
 */

import { pipeline } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

/**
 * Type alias for the embedder model (feature extraction pipeline).
 * Returned by initEmbedder() and used by embedText().
 */
export type EmbeddingModel = FeatureExtractionPipeline;

/**
 * Model identifier for the embedding model.
 * bge-small-en-v1.5: 384 dimensions, CPU-optimized, trained for semantic search.
 */
const MODEL_NAME = 'Xenova/bge-small-en-v1.5';

/**
 * Cache directory for downloaded model files.
 * Models are downloaded once and reused across runs.
 */
const MODEL_CACHE_DIR = '.oracle/models';

/**
 * Initializes the embedding model by loading the feature extraction pipeline.
 *
 * Downloads the model on first run (~50MB), subsequent runs load from cache.
 * Uses CPU inference - no GPU required.
 *
 * @returns Promise resolving to initialized embedding model
 * @throws Error if model fails to load
 */
export async function initEmbedder(): Promise<EmbeddingModel> {
  const embedder = await pipeline('feature-extraction', MODEL_NAME, {
    // Cache model files to avoid repeated downloads
    cache_dir: MODEL_CACHE_DIR,
    // Allow downloading if not cached
    local_files_only: false,
  });

  return embedder;
}

/**
 * Generates a normalized embedding vector for the given text.
 *
 * CRITICAL: Returns normalized embeddings for cosine similarity search.
 * Normalization is essential - without it, distance rankings are incorrect.
 *
 * @param embedder - Initialized embedding model from initEmbedder()
 * @param text - Text to embed (code chunk, query, etc.)
 * @returns Promise resolving to Float32Array embedding (384 dimensions, normalized)
 */
export async function embedText(embedder: EmbeddingModel, text: string): Promise<Float32Array> {
  // Generate embedding with mean pooling and normalization
  // - pooling: 'mean' aggregates token embeddings into sentence embedding
  // - normalize: true ensures vectors are unit length for cosine similarity
  const output = await embedder(text, {
    pooling: 'mean',
    normalize: true,
  });

  // Extract embedding as Float32Array from tensor output
  // tolist() converts tensor to nested arrays, [0] gets first (and only) embedding
  const embedding = output.tolist()[0] as number[];

  // Convert to Float32Array for USearch compatibility
  return new Float32Array(embedding);
}
