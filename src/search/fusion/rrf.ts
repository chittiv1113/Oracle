/**
 * Reciprocal Rank Fusion (RRF) algorithm for merging multiple ranked lists.
 *
 * RRF combines rankings from different retrieval methods (BM25, vector search)
 * without requiring score normalization. It's the industry standard for hybrid
 * search (used by OpenSearch, Azure AI Search, research papers).
 *
 * Formula: RRF_score(item) = Σ (1 / (rank_in_list + k))
 * where k=60 is the proven optimal smoothing factor.
 */

/**
 * Configuration options for RRF algorithm.
 */
export interface RRFOptions {
  /**
   * Smoothing factor for RRF calculation.
   * Default: 60 (proven optimal by research across k=1,10,60,100,1000)
   *
   * Higher k values reduce the impact of rank differences.
   * k=60 is the industry standard (Microsoft Azure, OpenSearch, research).
   */
  k?: number;
}

/**
 * Result from RRF fusion containing item ID and combined score.
 */
export interface RRFResult {
  /**
   * Item identifier (chunk ID from BM25 or vector search).
   * Can be string (BM25: "file:line") or number (vector: numeric ID).
   */
  id: string | number;

  /**
   * RRF combined score (sum of reciprocal ranks from all lists).
   * Higher score = more relevant across methods.
   */
  score: number;
}

/**
 * Merges multiple ranked lists using Reciprocal Rank Fusion.
 *
 * RRF is score-agnostic - only rank position matters. Items appearing in
 * multiple lists get higher scores. This makes it ideal for hybrid search
 * where BM25 and vector search use incompatible scoring scales.
 *
 * Algorithm steps:
 * 1. For each ranked list:
 *    - For each item at position `rank` (0-indexed):
 *      - Compute RRF score: 1 / (rank + 1 + k)
 *      - Add to item's accumulated score
 * 2. Sort items by accumulated score (descending)
 * 3. Return sorted results
 *
 * @param rankedLists - Array of ranked lists, each containing items with IDs
 * @param options - RRF configuration (k smoothing factor)
 * @returns Array of items sorted by RRF score (highest first)
 *
 * @example
 * ```typescript
 * const bm25Results = [{ id: 1 }, { id: 2 }, { id: 3 }];
 * const vectorResults = [{ id: 2 }, { id: 3 }, { id: 4 }];
 * const merged = reciprocalRankFusion([bm25Results, vectorResults]);
 * // Item 2 ranks highest (appears in both lists)
 * // Item 3 ranks second (appears in both lists)
 * // Items 1 and 4 rank lower (appear in only one list)
 * ```
 */
export function reciprocalRankFusion(
  rankedLists: Array<Array<{ id: string | number; score?: number }>>,
  options: RRFOptions = {},
): RRFResult[] {
  // Extract smoothing factor (default: 60)
  const k = options.k ?? 60;

  // Accumulate RRF scores for each item
  // Key: item ID (string or number)
  // Value: accumulated RRF score
  const scores = new Map<string | number, number>();

  // Process each ranked list
  for (const rankedList of rankedLists) {
    // Iterate over items with their rank positions (0-indexed)
    for (let rank = 0; rank < rankedList.length; rank++) {
      const item = rankedList[rank];

      // Calculate RRF score for this item at this rank
      // Formula: 1 / (rank + 1 + k)
      // - rank + 1: convert 0-indexed to 1-indexed
      // - + k: smoothing factor to reduce rank difference impact
      const rrfScore = 1 / (rank + 1 + k);

      // Add to accumulated score (items in multiple lists get higher scores)
      const currentScore = scores.get(item.id) ?? 0;
      scores.set(item.id, currentScore + rrfScore);
    }
  }

  // Convert Map to array of RRFResult
  const results: RRFResult[] = Array.from(scores.entries()).map(([id, score]) => ({
    id,
    score,
  }));

  // Sort by score descending (highest RRF score first)
  results.sort((a, b) => b.score - a.score);

  return results;
}
