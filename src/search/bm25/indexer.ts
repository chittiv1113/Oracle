/**
 * BM25 index builder using Orama for keyword-based code search.
 *
 * Purpose: Enable exact identifier matching for function names, class names,
 * error messages, and other code identifiers. Complements semantic search
 * by catching lexical matches that vectors might miss.
 */

import { create, insert } from '@orama/orama';
import type Database from 'better-sqlite3';
import { getAllChunks } from '../../persistence/repository.js';

/**
 * Schema for BM25 search index.
 *
 * Fields optimized for code search:
 * - id: Unique identifier (filePath:startLine)
 * - file_path: Searchable file path for location-based queries
 * - symbol_name: High-relevance field for function/class names
 * - content: Main search field containing code chunk text
 * - start_line, end_line: Metadata for result localization
 */
const BM25_SCHEMA = {
  id: 'string',
  file_path: 'string',
  symbol_name: 'string',
  content: 'string',
  start_line: 'number',
  end_line: 'number',
} as const;

/**
 * Type alias for Orama database instance with our schema.
 */
export type OramaDB = Awaited<ReturnType<typeof create<typeof BM25_SCHEMA>>>;

/**
 * Builds a BM25 search index from all chunks in the database.
 *
 * Implementation:
 * 1. Creates Orama database with code-optimized schema
 * 2. Loads all chunks from SQLite database
 * 3. Inserts each chunk into Orama index with searchable fields
 * 4. Returns the built index for search operations
 *
 * Edge cases:
 * - Empty database: Returns empty index (not an error)
 * - Null symbol_name: Coalesced to empty string for searchability
 *
 * Performance: O(n) where n = number of chunks. Async due to Orama's async API.
 *
 * @param db - SQLite database instance containing chunks
 * @returns Orama database instance ready for searching
 */
export async function buildBM25Index(db: Database.Database): Promise<OramaDB> {
  // Create Orama database with schema
  const oramaDb = await create({
    schema: BM25_SCHEMA,
  });

  // Load all chunks from SQLite
  const chunks = getAllChunks(db);

  // Insert each chunk into Orama index
  for (const chunk of chunks) {
    await insert(oramaDb, {
      id: `${chunk.filePath}:${chunk.startLine}`,
      file_path: chunk.filePath,
      symbol_name: chunk.symbolName ?? '', // Null coalescing for searchability
      content: chunk.content,
      start_line: chunk.startLine,
      end_line: chunk.endLine,
    });
  }

  return oramaDb;
}
