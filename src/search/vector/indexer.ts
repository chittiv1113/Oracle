/**
 * Vector index builder using USearch.
 *
 * Builds HNSW (Hierarchical Navigable Small World) index from database chunks
 * using semantic embeddings for similarity search.
 *
 * CRITICAL: Uses cosine similarity metric (matches bge-small-en-v1.5 training).
 * Embedding generation is the slowest step - progress callbacks are essential.
 */

import { Index, MetricKind, ScalarKind } from 'usearch';
import type { Database } from 'better-sqlite3';
import type { EmbeddingModel } from './embedder.js';
import { embedText } from './embedder.js';
import { getAllChunks } from '../../persistence/repository.js';

/**
 * Type alias for USearch vector index.
 * Used for similarity search operations.
 */
export type VectorIndex = Index;

/**
 * Builds a vector index from all chunks in the database.
 *
 * Process:
 * 1. Load all chunks from database
 * 2. Generate embeddings for each chunk (slowest step)
 * 3. Add embeddings to USearch HNSW index
 * 4. Return built index for search or persistence
 *
 * CRITICAL: Embedding is slow on CPU (~10-50ms per chunk).
 * For large repos (10k+ chunks), this can take minutes.
 * Use onProgress callback to provide user feedback.
 *
 * @param db - Database instance containing chunks
 * @param embedder - Initialized embedding model from initEmbedder()
 * @param onProgress - Optional callback for progress updates (current, total)
 * @returns Promise resolving to built vector index
 * @throws Error if database read or embedding generation fails
 */
export async function buildVectorIndex(
  db: Database,
  embedder: EmbeddingModel,
  onProgress?: (current: number, total: number) => void,
): Promise<VectorIndex> {
  // Create USearch index with configuration optimized for code search
  const index = new Index({
    // Cosine similarity - matches bge-small-en-v1.5 training
    // CRITICAL: Do NOT use 'ip' (dot product) or 'l2sq' (Euclidean)
    metric: MetricKind.Cos,

    // Embedding dimension from bge-small-en-v1.5
    dimensions: 384,

    // Float32 quantization (matches embeddings from transformers.js)
    quantization: ScalarKind.F32,

    // HNSW parameters (defaults are well-tuned per research)
    // connectivity: controls graph density (higher = better recall, slower build)
    connectivity: 16,

    // expansion_add: controls build-time search effort (higher = better index quality)
    expansion_add: 128,

    // expansion_search: controls query-time search effort (higher = better recall)
    expansion_search: 64,

    // multi: false for single vector per key (standard mode)
    multi: false,
  });

  // Load all chunks from database
  const chunks = getAllChunks(db);
  const total = chunks.length;

  // Handle empty database gracefully
  if (total === 0) {
    return index;
  }

  // Generate embeddings and add to index
  for (let i = 0; i < total; i++) {
    const chunk = chunks[i];

    // Generate embedding for chunk content
    const embedding = await embedText(embedder, chunk.content);

    // Add to index with chunk ID as key
    // CRITICAL: USearch requires BigInt keys
    // Using database row ID ensures we can look up chunks after search
    if (!chunk.id) {
      throw new Error(`Chunk at index ${i} missing required id field`);
    }
    index.add(BigInt(chunk.id), embedding);

    // Report progress if callback provided
    if (onProgress) {
      onProgress(i + 1, total);
    }
  }

  return index;
}
