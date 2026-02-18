/**
 * BM25 index persistence for saving and loading indexes from disk.
 *
 * Purpose: Enable fast startup by persisting built indexes to disk,
 * avoiding full rebuild on every application launch.
 */

import { persist, restore } from '@orama/plugin-data-persistence';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OramaDB } from './indexer.js';

/**
 * Saves a BM25 index to disk in binary format.
 *
 * Implementation:
 * 1. Serializes Orama index to binary format using plugin
 * 2. Creates parent directory if needed (recursive)
 * 3. Writes binary data to file
 *
 * Error handling: Throws descriptive errors on failure
 *
 * Performance: O(n) where n = index size. Binary format is compact.
 *
 * Note: @orama/plugin-data-persistence has 512MB file size limit.
 * For Phase 3, this is acceptable. Phase 6 can implement custom
 * persistence using JSON/MessagePack if limit is reached in practice.
 *
 * @param db - Orama database instance to save
 * @param path - File path to write index to (e.g., .oracle/bm25.orama)
 * @throws Error if serialization or file write fails
 */
export async function saveBM25Index(db: OramaDB, path: string): Promise<void> {
  try {
    // Serialize index to binary format
    const raw = await persist(db, 'binary');

    // Ensure parent directory exists
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });

    // Write binary data to file
    await writeFile(path, raw as Buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = new Error(`Failed to save BM25 index to ${path}: ${message}`);
    err.cause = error;
    throw err;
  }
}

/**
 * Loads a BM25 index from disk.
 *
 * Implementation:
 * 1. Checks if file exists, returns null if not found
 * 2. Reads binary data from file
 * 3. Deserializes using Orama plugin
 * 4. Returns restored index ready for searching
 *
 * Error handling: Returns null on any failure (file not found, corrupted data)
 * This allows graceful fallback to rebuilding the index.
 *
 * Performance: O(n) where n = index size. Faster than rebuilding from database.
 *
 * @param path - File path to load index from
 * @returns Orama database instance if successful, null if file not found or corrupted
 */
export async function loadBM25Index(path: string): Promise<OramaDB | null> {
  try {
    // Check if file exists (throws if not accessible)
    await access(path);

    // Read binary data from file
    const raw = await readFile(path);

    // Deserialize using Orama plugin
    const db = (await restore('binary', raw)) as OramaDB;

    return db;
  } catch {
    // Return null on any error (file not found, corrupted data, etc.)
    // Caller can fall back to rebuilding the index
    return null;
  }
}
