/**
 * Vector index persistence using USearch save/load.
 *
 * Saves and loads vector indexes to/from disk for fast startup.
 * USearch binary format is cross-platform and has no size limits.
 */

import fs from 'fs';
import path from 'path';
import { Index, MetricKind, ScalarKind } from 'usearch';
import type { VectorIndex } from './indexer.js';

/**
 * Default path for persisted vector index.
 * Stored in .oracle/ directory alongside other indexes.
 */
export const DEFAULT_VECTOR_INDEX_PATH = '.oracle/vectors.usearch';

/**
 * Saves vector index to disk.
 *
 * Creates parent directory if needed. Uses USearch's built-in binary format
 * which is efficient and cross-platform compatible.
 *
 * @param index - Built vector index to save
 * @param indexPath - Path to save index file (default: .oracle/vectors.usearch)
 * @throws Error if directory creation or save operation fails
 */
export async function saveVectorIndex(
  index: VectorIndex,
  indexPath: string = DEFAULT_VECTOR_INDEX_PATH,
): Promise<void> {
  // Create parent directory if it doesn't exist
  const parentDir = path.dirname(indexPath);

  try {
    await fs.promises.mkdir(parentDir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Failed to create directory ${parentDir}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  // Save index using USearch's built-in save
  try {
    index.save(indexPath);
  } catch (error) {
    throw new Error(
      `Failed to save vector index to ${indexPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Loads vector index from disk.
 *
 * Returns null if file doesn't exist or is corrupted. Creates new Index with
 * same configuration as buildVectorIndex() and loads persisted data.
 *
 * CRITICAL: Index configuration must match the saved index (384 dims, cosine, f32).
 *
 * @param indexPath - Path to load index from (default: .oracle/vectors.usearch)
 * @returns Loaded vector index, or null if file not found or corrupted
 */
export async function loadVectorIndex(
  indexPath: string = DEFAULT_VECTOR_INDEX_PATH,
): Promise<VectorIndex | null> {
  // Check if file exists
  try {
    await fs.promises.access(indexPath);
  } catch {
    // File doesn't exist - return null
    return null;
  }

  // Create new index with same config as buildVectorIndex
  // CRITICAL: Configuration must match the saved index
  const index = new Index({
    metric: MetricKind.Cos,
    dimensions: 384,
    quantization: ScalarKind.F32,
    connectivity: 16,
    expansion_add: 128,
    expansion_search: 64,
    multi: false,
  });

  // Load index data from disk
  try {
    index.load(indexPath);
    return index;
  } catch (error) {
    // File is corrupted or incompatible - return null
    console.error(
      `Failed to load vector index from ${indexPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
