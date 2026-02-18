/**
 * SQLite schema definitions and database initialization.
 *
 * Provides schema creation, WAL mode configuration, and database initialization
 * for the indexing persistence layer.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * Current schema version for migration tracking.
 * Increment when schema changes are made.
 */
export const SCHEMA_VERSION = 1;

/**
 * Default database file path (relative to repository root).
 * The database is stored in .oracle/ directory.
 */
export const DEFAULT_DB_PATH = '.oracle/index.db';

/**
 * SQL schema for the chunks table.
 * Stores code chunks with metadata and content hashing for incremental updates.
 */
const CHUNKS_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  symbol_name TEXT,
  symbol_type TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  language TEXT NOT NULL,
  indexed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_file_path ON chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_content_hash ON chunks(content_hash);
CREATE INDEX IF NOT EXISTS idx_symbol_name ON chunks(symbol_name);
CREATE INDEX IF NOT EXISTS idx_language ON chunks(language);
`;

/**
 * SQL schema for the schema_migrations table.
 * Tracks applied migrations for version management.
 */
const MIGRATIONS_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

/**
 * Initializes SQLite database with schema and WAL mode.
 *
 * Creates .oracle/ directory if it doesn't exist, initializes database with
 * chunks table, enables WAL mode for concurrent reads, and sets schema version.
 *
 * CRITICAL: WAL mode enables concurrent reads during writes, essential for
 * indexing pipeline performance.
 *
 * @param dbPath - Path to database file (defaults to .oracle/index.db)
 * @returns Initialized database instance
 * @throws Error if database is corrupted or directory creation fails
 */
export function initDatabase(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  // Create parent directory if it doesn't exist
  const parentDir = path.dirname(dbPath);

  try {
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  } catch (error) {
    throw new Error(
      `Failed to create database directory ${parentDir}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  // Open database (creates file if doesn't exist)
  let db: Database.Database;

  try {
    db = new Database(dbPath);
  } catch (error) {
    throw new Error(
      `Failed to open database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  // Enable WAL mode for concurrent reads during writes
  // CRITICAL: This allows multiple readers during indexing operations
  db.pragma('journal_mode = WAL');

  // Enable foreign keys (SQLite disables by default)
  db.pragma('foreign_keys = ON');

  // Create schema tables
  try {
    db.exec(CHUNKS_TABLE_SCHEMA);
    db.exec(MIGRATIONS_TABLE_SCHEMA);
  } catch (error) {
    db.close();
    throw new Error(
      `Failed to create schema: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  // Set schema version using PRAGMA user_version
  db.pragma(`user_version = ${SCHEMA_VERSION}`);

  return db;
}
