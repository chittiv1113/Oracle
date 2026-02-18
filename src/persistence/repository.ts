/**
 * Database repository operations for code chunks.
 *
 * Provides CRUD operations with batch insert optimization using transactions.
 * Implements patterns from better-sqlite3 performance best practices.
 */

import type Database from 'better-sqlite3';

/**
 * Data structure for a code chunk row in the database.
 * Maps to the chunks table schema.
 */
export interface ChunkRow {
  id?: number; // Optional for insert operations, required for retrieval
  filePath: string;
  symbolName: string | null;
  symbolType: string;
  content: string;
  contentHash: string;
  startLine: number;
  endLine: number;
  language: string;
}

/**
 * Inserts multiple chunks in a single transaction for maximum performance.
 *
 * CRITICAL: Uses transaction batching for 100x+ performance improvement over
 * individual inserts. Research shows this is essential for indexing large repos.
 *
 * After batch insert, executes WAL checkpoint to prevent .db-wal file growth
 * (see research pitfall #3).
 *
 * @param db - Database instance
 * @param chunks - Array of chunks to insert
 */
export function insertChunksBatch(db: Database.Database, chunks: ChunkRow[]): void {
  if (chunks.length === 0) return;

  // Prepare statement once (reused for all inserts)
  const insert = db.prepare(`
    INSERT INTO chunks (
      file_path,
      symbol_name,
      symbol_type,
      content,
      content_hash,
      start_line,
      end_line,
      language
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Wrap inserts in transaction for 100x+ performance
  const insertMany = db.transaction((chunksToInsert: ChunkRow[]) => {
    for (const chunk of chunksToInsert) {
      insert.run(
        chunk.filePath,
        chunk.symbolName,
        chunk.symbolType,
        chunk.content,
        chunk.contentHash,
        chunk.startLine,
        chunk.endLine,
        chunk.language,
      );
    }
  });

  // Execute transaction (commits once at end)
  insertMany(chunks);

  // Checkpoint WAL to prevent unbounded growth (critical for large batches)
  db.pragma('wal_checkpoint(TRUNCATE)');
}

/**
 * Deletes all chunks from the database.
 *
 * Used for full re-indexing: clear everything before inserting fresh data.
 *
 * @param db - Database instance
 */
export function deleteAllChunks(db: Database.Database): void {
  db.prepare('DELETE FROM chunks').run();
}

/**
 * Deletes all chunks associated with a specific file.
 *
 * Used for incremental updates: delete old chunks before inserting new ones.
 *
 * @param db - Database instance
 * @param filePath - Path to the file whose chunks should be deleted
 */
export function deleteChunksByFile(db: Database.Database, filePath: string): void {
  const deleteStmt = db.prepare('DELETE FROM chunks WHERE file_path = ?');
  deleteStmt.run(filePath);
}

/**
 * Retrieves all chunks for a specific file.
 *
 * Used for verification and debugging.
 *
 * @param db - Database instance
 * @param filePath - Path to the file
 * @returns Array of chunk rows for the file
 */
export function getChunksByFile(db: Database.Database, filePath: string): ChunkRow[] {
  const selectStmt = db.prepare('SELECT * FROM chunks WHERE file_path = ?');
  const rows = selectStmt.all(filePath) as Array<{
    file_path: string;
    symbol_name: string | null;
    symbol_type: string;
    content: string;
    content_hash: string;
    start_line: number;
    end_line: number;
    language: string;
  }>;

  // Map database column names to ChunkRow interface
  return rows.map((row) => ({
    filePath: row.file_path,
    symbolName: row.symbol_name,
    symbolType: row.symbol_type,
    content: row.content,
    contentHash: row.content_hash,
    startLine: row.start_line,
    endLine: row.end_line,
    language: row.language,
  }));
}

/**
 * Retrieves a chunk by its content hash.
 *
 * Used for incremental indexing to check if a chunk already exists.
 *
 * @param db - Database instance
 * @param contentHash - SHA-256 hash of the chunk content
 * @returns Chunk row if found, null otherwise
 */
export function getChunkByHash(db: Database.Database, contentHash: string): ChunkRow | null {
  const selectStmt = db.prepare('SELECT * FROM chunks WHERE content_hash = ? LIMIT 1');
  const row = selectStmt.get(contentHash) as
    | {
        file_path: string;
        symbol_name: string | null;
        symbol_type: string;
        content: string;
        content_hash: string;
        start_line: number;
        end_line: number;
        language: string;
      }
    | undefined;

  if (!row) return null;

  // Map database column names to ChunkRow interface
  return {
    filePath: row.file_path,
    symbolName: row.symbol_name,
    symbolType: row.symbol_type,
    content: row.content,
    contentHash: row.content_hash,
    startLine: row.start_line,
    endLine: row.end_line,
    language: row.language,
  };
}

/**
 * Retrieves all distinct file paths in the database.
 *
 * Used for listing indexed files.
 *
 * @param db - Database instance
 * @returns Array of file paths sorted alphabetically
 */
export function getAllFilePaths(db: Database.Database): string[] {
  const selectStmt = db.prepare('SELECT DISTINCT file_path FROM chunks ORDER BY file_path');
  const rows = selectStmt.all() as Array<{ file_path: string }>;
  return rows.map((row) => row.file_path);
}

/**
 * Retrieves all chunks from the database.
 *
 * Used for building search indexes (BM25, vector).
 *
 * @param db - Database instance
 * @returns Array of all chunk rows
 */
export function getAllChunks(db: Database.Database): ChunkRow[] {
  const selectStmt = db.prepare('SELECT * FROM chunks');
  const rows = selectStmt.all() as Array<{
    id: number;
    file_path: string;
    symbol_name: string | null;
    symbol_type: string;
    content: string;
    content_hash: string;
    start_line: number;
    end_line: number;
    language: string;
  }>;

  // Map database column names to ChunkRow interface
  return rows.map((row) => ({
    id: row.id,
    filePath: row.file_path,
    symbolName: row.symbol_name,
    symbolType: row.symbol_type,
    content: row.content,
    contentHash: row.content_hash,
    startLine: row.start_line,
    endLine: row.end_line,
    language: row.language,
  }));
}

/**
 * Retrieves multiple chunks by their IDs.
 *
 * Used for hydrating RRF results with full chunk data.
 * Returns chunks in arbitrary order - caller should map by ID if order matters.
 *
 * @param db - Database instance
 * @param ids - Array of chunk IDs to retrieve
 * @returns Array of chunk rows (may be fewer than requested if some IDs don't exist)
 */
export function getChunksByIds(db: Database.Database, ids: number[]): ChunkRow[] {
  // Handle edge case: empty ID array
  if (ids.length === 0) return [];

  // Build parameterized query with correct number of placeholders
  // SQLite IN clause requires: WHERE id IN (?, ?, ?)
  const placeholders = ids.map(() => '?').join(', ');
  const query = `SELECT * FROM chunks WHERE id IN (${placeholders})`;

  const selectStmt = db.prepare(query);
  const rows = selectStmt.all(...ids) as Array<{
    id: number;
    file_path: string;
    symbol_name: string | null;
    symbol_type: string;
    content: string;
    content_hash: string;
    start_line: number;
    end_line: number;
    language: string;
  }>;

  // Map database column names to ChunkRow interface
  return rows.map((row) => ({
    id: row.id,
    filePath: row.file_path,
    symbolName: row.symbol_name,
    symbolType: row.symbol_type,
    content: row.content,
    contentHash: row.content_hash,
    startLine: row.start_line,
    endLine: row.end_line,
    language: row.language,
  }));
}
