/**
 * Vector search interface for USearch index.
 *
 * Queries vector index using embedding similarity (cosine distance) and
 * returns ranked chunk IDs with similarity scores.
 */

import type { VectorIndex } from './indexer.js';

/**
 * Search result from vector index.
 * Contains chunk ID and similarity score for ranking.
 */
export interface VectorResult {
  /** Chunk ID from database (maps to chunks.id) */
  id: number;

  /** Cosine similarity score (0-1, higher is more similar) */
  score: number;
}

/**
 * Searches vector index for chunks similar to the query embedding.
 *
 * Uses cosine similarity (via USearch) to find semantically related chunks.
 * Results are pre-sorted by USearch in descending similarity order.
 *
 * @param index - Built vector index from buildVectorIndex()
 * @param queryEmbedding - Query embedding from embedText()
 * @param limit - Maximum number of results to return (default: 100)
 * @returns Array of VectorResult sorted by similarity (highest first)
 */
export async function searchVector(
  index: VectorIndex,
  queryEmbedding: Float32Array,
  limit: number = 100,
): Promise<VectorResult[]> {
  // Handle edge cases
  if (limit <= 0) {
    return [];
  }

  if (queryEmbedding.length === 0) {
    return [];
  }

  // Search index for nearest neighbors
  // USearch returns { keys: bigint[], distances: number[] }
  // threads=1 for single-threaded search (CPU-only, simple usage)
  const results = index.search(queryEmbedding, limit, 1);

  // Convert to VectorResult array
  // CRITICAL: USearch returns cosine *distance* (0-2), not similarity
  // Convert to similarity score: similarity = 1 - (distance / 2)
  // For normalized vectors with cosine metric, distance is already 0-2
  const vectorResults: VectorResult[] = [];

  for (let i = 0; i < results.keys.length; i++) {
    const id = Number(results.keys[i]);
    const distance = results.distances[i];

    // Convert cosine distance to similarity score
    // USearch cosine distance is 1 - cosine_similarity, so we invert it
    const score = 1 - distance;

    vectorResults.push({ id, score });
  }

  return vectorResults;
}
