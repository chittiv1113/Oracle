/**
 * Hybrid search orchestration using BM25 + Vector search with RRF fusion.
 *
 * Combines keyword-based (BM25) and semantic (vector) retrieval for
 * comprehensive code search. Uses Reciprocal Rank Fusion to merge results
 * without score normalization.
 *
 * Key optimization: Parallel execution of BM25 search and query embedding
 * (saves ~100-300ms per research).
 */

import type { Database } from 'better-sqlite3';
import type { OramaDB } from './bm25/indexer.js';
import type { VectorIndex } from './vector/indexer.js';
import type { EmbeddingModel } from './vector/embedder.js';
import { searchBM25 } from './bm25/searcher.js';
import { searchVector } from './vector/searcher.js';
import { embedText } from './vector/embedder.js';
import { reciprocalRankFusion } from './fusion/rrf.js';
import { mergeResults } from './fusion/merger.js';

/**
 * Configuration options for hybrid search.
 */
export interface SearchOptions {
  /**
   * Number of BM25 candidates to retrieve.
   * Default: 200 (research guidance for keyword candidates)
   *
   * Higher values increase recall but slow down fusion.
   */
  bm25Limit?: number;

  /**
   * Number of vector candidates to retrieve.
   * Default: 100 (research guidance for semantic candidates)
   *
   * Higher values increase recall but slow down fusion.
   */
  vectorLimit?: number;

  /**
   * Number of final results after RRF fusion.
   * Default: 30 (research guidance for reranking input size)
   *
   * This is the maximum number of results returned to caller.
   */
  fusionLimit?: number;

  /**
   * RRF smoothing factor (k parameter).
   * Default: 60 (industry standard)
   *
   * Rarely needs changing - k=60 is proven optimal.
   */
  rrfK?: number;
}

/**
 * Final search result with full chunk data and RRF score.
 *
 * This is the output of hybrid search, ready for presentation or reranking.
 */
export interface SearchResult {
  /** Database chunk ID */
  id: number;

  /** Path to source file */
  filePath: string;

  /** Symbol name (function, class, etc.) or empty string */
  symbolName: string;

  /** Chunk content (code text) */
  content: string;

  /** Starting line number in source file */
  startLine: number;

  /** Ending line number in source file */
  endLine: number;

  /** RRF combined score from fusion */
  score: number;
}

/**
 * Performs hybrid search combining BM25 keyword search and vector semantic search.
 *
 * Process:
 * 1. Run BM25 search in parallel with query embedding (performance optimization)
 * 2. Run vector search using query embedding
 * 3. Merge results using Reciprocal Rank Fusion (RRF)
 * 4. Take top N results (fusionLimit)
 * 5. Hydrate with full chunk data from database
 *
 * CRITICAL: BM25 and vector search use different ID formats:
 * - BM25: string format "filePath:startLine" (from indexer)
 * - Vector: numeric chunk.id (database primary key)
 *
 * Solution: Convert BM25 results to numeric IDs by looking up chunks.
 *
 * Edge cases:
 * - Empty query: Returns empty array
 * - No BM25 matches: Returns vector-only results
 * - No vector matches: Returns BM25-only results
 * - Empty database: Returns empty array
 *
 * @param query - Search query string (natural language or code identifiers)
 * @param db - Database instance
 * @param bm25Index - Built BM25 index from buildBM25Index()
 * @param vectorIndex - Built vector index from buildVectorIndex()
 * @param embedder - Initialized embedding model from initEmbedder()
 * @param options - Search configuration options
 * @returns Promise resolving to array of search results sorted by RRF score
 *
 * @example
 * ```typescript
 * const results = await hybridSearch(
 *   'authentication function',
 *   db,
 *   bm25Index,
 *   vectorIndex,
 *   embedder,
 *   { fusionLimit: 10 }
 * );
 * // Returns top 10 chunks combining keyword and semantic matches
 * ```
 */
export async function hybridSearch(
  query: string,
  db: Database,
  bm25Index: OramaDB,
  vectorIndex: VectorIndex,
  embedder: EmbeddingModel,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  // Handle edge case: empty query
  if (!query || query.trim() === '') {
    return [];
  }

  // Extract options with defaults (research-based values)
  const bm25Limit = options.bm25Limit ?? 200;
  const vectorLimit = options.vectorLimit ?? 100;
  const fusionLimit = options.fusionLimit ?? 30;
  const rrfK = options.rrfK ?? 60;

  // CRITICAL: Parallel execution pattern for performance
  // Generate query embedding in parallel with BM25 search (saves ~100-300ms)
  const [bm25Results, queryEmbedding] = await Promise.all([
    searchBM25(bm25Index, query, bm25Limit),
    embedText(embedder, query),
  ]);

  // Run vector search with query embedding
  const vectorResults = await searchVector(vectorIndex, queryEmbedding, vectorLimit);

  // Convert BM25 results to common format for RRF
  // CRITICAL: BM25 uses string IDs, but we need numeric IDs for final lookup
  // We'll use the BM25 string IDs directly in RRF, then convert in merger
  const bm25Formatted = bm25Results.map((r) => ({ id: r.id }));

  // Convert vector results to common format for RRF
  const vectorFormatted = vectorResults.map((r) => ({ id: r.id }));

  // Apply RRF fusion to merge rankings
  const fusedResults = reciprocalRankFusion([bm25Formatted, vectorFormatted], { k: rrfK });

  // Take top fusionLimit results (research guidance: don't send 300 results to reranker)
  const topFused = fusedResults.slice(0, fusionLimit);

  // CRITICAL: BM25 uses string IDs "file:line", vector uses numeric IDs
  // We need to convert BM25 string IDs to numeric chunk IDs for database lookup
  // Strategy: For BM25 results, parse the ID and look up by file+line
  // For vector results, use ID directly

  // Separate BM25 and vector IDs
  const bm25Ids = new Set(bm25Results.map((r) => r.id));
  const bm25FusedIds: string[] = [];
  const vectorFusedIds: number[] = [];

  for (const result of topFused) {
    if (typeof result.id === 'string' && bm25Ids.has(result.id)) {
      bm25FusedIds.push(result.id);
    } else {
      vectorFusedIds.push(Number(result.id));
    }
  }

  // Look up BM25 chunks by file:line ID to get numeric IDs
  // Create a map from string ID to numeric ID
  const bm25IdMap = new Map<string, number>();
  if (bm25FusedIds.length > 0) {
    // For each BM25 ID, we need to find the corresponding chunk
    // Parse the "file:line" format and query database
    // This is inefficient but necessary due to ID format mismatch
    // Better solution: Store numeric ID in BM25 index (future optimization)

    // For now, we'll use a different approach:
    // Get all chunks that match the BM25 results and create a lookup map
    const bm25ChunkMap = new Map(
      bm25Results.map((r) => [
        r.id,
        {
          filePath: r.filePath,
          startLine: r.startLine,
        },
      ]),
    );

    // Query database for these specific file:line combinations
    // Since we don't have a direct lookup, we'll need to get chunks by file
    // and filter by line number (not ideal, but works)
    // Actually, we can use the original BM25 results which have all data
    const stmt = db.prepare('SELECT id FROM chunks WHERE file_path = ? AND start_line = ? LIMIT 1');

    for (const [stringId, info] of bm25ChunkMap.entries()) {
      const row = stmt.get(info.filePath, info.startLine) as { id: number } | undefined;
      if (row) {
        bm25IdMap.set(stringId, row.id);
      }
    }
  }

  // Convert all fused result IDs to numeric IDs
  const numericFusedResults = topFused
    .map((r) => {
      if (typeof r.id === 'string') {
        const numericId = bm25IdMap.get(r.id);
        if (!numericId) return null;
        return { id: numericId, score: r.score };
      }
      return { id: Number(r.id), score: r.score };
    })
    .filter((r): r is { id: number; score: number } => r !== null);

  // Hydrate with chunk data
  const finalResults = mergeResults(db, numericFusedResults);

  return finalResults;
}
