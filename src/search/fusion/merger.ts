/**
 * Result merger for hybrid search - hydrates RRF scores with full chunk data.
 *
 * Converts RRF results (IDs + scores) into complete search results by loading
 * chunk data from the database. This is the final step in the hybrid search
 * pipeline after BM25 + vector fusion.
 */

import type { Database } from 'better-sqlite3';
import type { RRFResult } from './rrf.js';
import { getChunksByIds } from '../../persistence/repository.js';

/**
 * Unified search result with full chunk data and RRF score.
 *
 * This is the final output format for hybrid search, ready for reranking
 * or direct presentation to the user.
 */
export interface UnifiedResult {
  /** Database chunk ID */
  id: number;

  /** Path to source file */
  filePath: string;

  /** Symbol name (function, class, etc.) or null for file-level chunks */
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
 * Merges RRF results with database chunks to produce complete search results.
 *
 * Takes the output of reciprocalRankFusion (IDs + scores) and hydrates with
 * full chunk data (file path, content, line numbers, etc.).
 *
 * Handles edge cases:
 * - Missing chunks (deleted after indexing): skipped
 * - Empty RRF results: returns empty array
 * - Preserves RRF score order
 *
 * @param db - Database instance
 * @param rrfResults - Results from reciprocalRankFusion (sorted by score)
 * @returns Array of unified results with full chunk data, same order as input
 *
 * @example
 * ```typescript
 * // After RRF fusion
 * const rrfResults = reciprocalRankFusion([bm25Results, vectorResults]);
 *
 * // Hydrate with chunk data
 * const finalResults = mergeResults(db, rrfResults);
 * // Now have full chunk data (file paths, content, lines) with RRF scores
 * ```
 */
export function mergeResults(db: Database, rrfResults: RRFResult[]): UnifiedResult[] {
  // Handle edge case: empty RRF results
  if (rrfResults.length === 0) {
    return [];
  }

  // Extract chunk IDs from RRF results
  // Convert to numbers (vector search uses numeric IDs, BM25 IDs are converted)
  const ids = rrfResults.map((r) => Number(r.id));

  // Load chunks from database (batch query)
  const chunks = getChunksByIds(db, ids);

  // Create Map for O(1) chunk lookup by ID
  const chunkMap = new Map(chunks.map((chunk) => [chunk.id!, chunk]));

  // Map RRF results to UnifiedResult by joining with chunks
  // Preserve RRF order (already sorted by score)
  const unifiedResults = rrfResults
    .map((rrfResult) => {
      const chunkId = Number(rrfResult.id);
      const chunk = chunkMap.get(chunkId);

      // Skip if chunk not found (may have been deleted after indexing)
      if (!chunk) {
        return null;
      }

      // Combine RRF score with chunk data
      return {
        id: chunk.id!,
        filePath: chunk.filePath,
        symbolName: chunk.symbolName ?? '', // Convert null to empty string
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score: rrfResult.score,
      };
    })
    .filter((result): result is UnifiedResult => result !== null);

  return unifiedResults;
}
