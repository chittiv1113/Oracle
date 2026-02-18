/**
 * BM25 search interface for querying the keyword index.
 *
 * Purpose: Execute term-based queries against the BM25 index to find
 * code chunks matching exact identifiers, function names, or keywords.
 */

import { search } from '@orama/orama';
import type { OramaDB } from './indexer.js';

/**
 * Search result from BM25 query.
 *
 * Contains chunk metadata and BM25 relevance score for ranking.
 */
export interface BM25Result {
  id: string; // Chunk identifier (file:line)
  filePath: string;
  symbolName: string;
  content: string;
  startLine: number;
  endLine: number;
  score: number; // BM25 relevance score
}

/**
 * Searches the BM25 index for chunks matching the query.
 *
 * Implementation:
 * - Uses Orama's search() with term-based matching
 * - Returns results sorted by BM25 score (descending)
 * - Maps Orama hits to BM25Result interface
 *
 * Edge cases:
 * - Empty query: Returns empty array (Orama would error)
 * - No results: Returns empty array
 * - limit=0: Returns empty array
 *
 * Performance: O(log n + k) where n = index size, k = result count
 *
 * @param db - Orama database instance (from buildBM25Index)
 * @param query - Search query string (keywords or identifiers)
 * @param limit - Maximum number of results to return (default: 100)
 * @returns Array of BM25 results sorted by relevance (highest first)
 */
export async function searchBM25(
  db: OramaDB,
  query: string,
  limit: number = 100,
): Promise<BM25Result[]> {
  // Handle edge cases
  if (!query || query.trim() === '' || limit <= 0) {
    return [];
  }

  // Execute Orama search with term query
  const results = await search(db, {
    term: query,
    limit,
  });

  // Map Orama hits to BM25Result interface
  return results.hits.map((hit) => ({
    id: hit.id as string,
    filePath: hit.document.file_path as string,
    symbolName: hit.document.symbol_name as string,
    content: hit.document.content as string,
    startLine: hit.document.start_line as number,
    endLine: hit.document.end_line as number,
    score: hit.score,
  }));
}
