/**
 * Schema migration system with version tracking.
 *
 * Provides migration framework for database schema evolution.
 * Uses PRAGMA user_version and schema_migrations table for tracking.
 */

import type Database from 'better-sqlite3';

/**
 * Migration definition interface.
 * Each migration has a version number, description, and up function.
 */
export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

/**
 * Registry of all migrations.
 * Add new migrations here as schema evolves.
 *
 * IMPORTANT: Migrations must be sequential (version 2, 3, 4...).
 * Version 1 is the baseline schema from schema.ts.
 *
 * Example future migration:
 * {
 *   version: 2,
 *   description: "Add embeddings table for vector storage",
 *   up: (db) => {
 *     db.exec(`
 *       CREATE TABLE embeddings (
 *         chunk_id INTEGER NOT NULL,
 *         embedding BLOB NOT NULL,
 *         FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
 *       );
 *       CREATE INDEX idx_chunk_id ON embeddings(chunk_id);
 *     `);
 *   }
 * }
 */
const migrations: Migration[] = [
  // Migrations will be added here as schema evolves
  // Version 1 (baseline) is defined in schema.ts
];

/**
 * Gets the current schema version from the database.
 *
 * Uses PRAGMA user_version which provides atomic version tracking.
 *
 * @param db - Database instance
 * @returns Current schema version (0 if new database)
 */
export function getCurrentVersion(db: Database.Database): number {
  const version = db.pragma('user_version', { simple: true }) as number;
  return version;
}

/**
 * Retrieves list of applied migrations from schema_migrations table.
 *
 * Provides audit trail of migration history.
 *
 * @param db - Database instance
 * @returns Array of version numbers that have been applied
 */
export function getAppliedMigrations(db: Database.Database): number[] {
  const selectStmt = db.prepare('SELECT version FROM schema_migrations ORDER BY version');
  const rows = selectStmt.all() as Array<{ version: number }>;
  return rows.map((row) => row.version);
}

/**
 * Runs all pending migrations in order.
 *
 * Filters migrations to those with version > current version,
 * executes them sequentially, and updates version tracking.
 *
 * CRITICAL: If any migration fails, the process stops and throws.
 * Partial migrations are not committed.
 *
 * @param db - Database instance
 * @throws Error if migration fails
 */
export function runMigrations(db: Database.Database): void {
  const currentVersion = getCurrentVersion(db);

  // Filter to pending migrations (version > current)
  const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    // No pending migrations
    return;
  }

  // Sort by version ascending (should already be sorted, but ensure it)
  pendingMigrations.sort((a, b) => a.version - b.version);

  // Apply each migration
  for (const migration of pendingMigrations) {
    try {
      console.log(`Applying migration ${migration.version}: ${migration.description}`);

      // Execute migration
      migration.up(db);

      // Record in schema_migrations table
      const insertStmt = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
      insertStmt.run(migration.version);

      // Update PRAGMA user_version
      db.pragma(`user_version = ${migration.version}`);

      console.log(`Successfully applied migration ${migration.version}`);
    } catch (error) {
      const message = `Failed to apply migration ${migration.version}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(message);
      throw new Error(message, { cause: error });
    }
  }
}
