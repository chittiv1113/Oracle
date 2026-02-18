/**
 * Main indexer orchestration for code repository indexing.
 *
 * Orchestrates the complete indexing pipeline: file discovery → AST chunking → database persistence.
 * Supports both full indexing and incremental updates via git diff and content hash comparison.
 */

import { readFile } from 'fs/promises';
import cliProgress from 'cli-progress';
import { simpleGit } from 'simple-git';
import { discoverFiles } from './loader.js';
import { initParser, chunkCodeFile } from './chunker.js';
import type { ParserCache } from './chunker.js';
import { initDatabase } from '../persistence/schema.js';
import { runMigrations } from '../persistence/migrations.js';
import {
  insertChunksBatch,
  deleteAllChunks,
  deleteChunksByFile,
  getChunksByFile,
} from '../persistence/repository.js';
import type { ChunkRow } from '../persistence/repository.js';
import { hashContent } from './hasher.js';
import { typescriptQueryConfig } from './languages/typescript.js';
import { javascriptQueryConfig } from './languages/javascript.js';
import { pythonQueryConfig } from './languages/python.js';
import type Database from 'better-sqlite3';
import { buildBM25Index } from '../search/bm25/indexer.js';
import { saveBM25Index } from '../search/bm25/persistence.js';
import { initEmbedder } from '../search/vector/embedder.js';
import { buildVectorIndex } from '../search/vector/indexer.js';
import { saveVectorIndex, DEFAULT_VECTOR_INDEX_PATH } from '../search/vector/persistence.js';

/**
 * Configuration options for indexing operations.
 */
export interface IndexOptions {
  /** Absolute path to repository root */
  repoPath: string;
  /** Path to SQLite database file (defaults to .oracle/index.db) */
  dbPath?: string;
  /** Enable incremental mode (update only changed files) */
  incremental?: boolean;
  /** Maximum file size in bytes before skipping (defaults to 500KB) */
  maxFileSizeBytes?: number;
}

/**
 * Statistics returned after indexing operation completes.
 */
export interface IndexStats {
  /** Total files discovered during scan */
  filesDiscovered: number;
  /** Files successfully processed and indexed */
  filesProcessed: number;
  /** Files that failed to process (errors logged) */
  filesFailed: number;
  /** Total code chunks created and persisted */
  chunksCreated: number;
  /** Total duration of indexing operation in milliseconds */
  durationMs: number;
}

/**
 * Performs full repository indexing.
 *
 * Discovers all code files, parses them with tree-sitter, extracts AST chunks,
 * and persists to SQLite database. Displays progress bars and handles partial failures.
 *
 * @param options - Indexing configuration
 * @returns Statistics about the indexing operation
 * @throws Error if database initialization or critical operations fail
 */
export async function indexRepository(options: IndexOptions): Promise<IndexStats> {
  const startTime = Date.now();
  const stats: IndexStats = {
    filesDiscovered: 0,
    filesProcessed: 0,
    filesFailed: 0,
    chunksCreated: 0,
    durationMs: 0,
  };

  let db: Database.Database | null = null;

  try {
    // Stage 1: Initialize database, run migrations, and clear old data
    console.log('Initializing database...');
    db = initDatabase(options.dbPath);
    runMigrations(db);
    deleteAllChunks(db);

    // Stage 2: Initialize language parsers
    const spinner = new cliProgress.SingleBar(
      {
        format: 'Initializing parsers... {bar}',
      },
      cliProgress.Presets.shades_classic,
    );
    spinner.start(3, 0);

    const parserMap = new Map<string, ParserCache>();

    // Load TypeScript parser
    const tsParser = await initParser(typescriptQueryConfig);
    for (const ext of typescriptQueryConfig.extensions) {
      parserMap.set(ext, tsParser);
    }
    spinner.increment();

    // Load JavaScript parser
    const jsParser = await initParser(javascriptQueryConfig);
    for (const ext of javascriptQueryConfig.extensions) {
      parserMap.set(ext, jsParser);
    }
    spinner.increment();

    // Load Python parser
    const pyParser = await initParser(pythonQueryConfig);
    for (const ext of pythonQueryConfig.extensions) {
      parserMap.set(ext, pyParser);
    }
    spinner.increment();

    spinner.stop();
    console.log('Parsers initialized successfully\n');

    // Stage 3: Discover files
    const files = await discoverFiles(options.repoPath, {
      maxFileSizeBytes: options.maxFileSizeBytes,
    });
    stats.filesDiscovered = files.length;
    console.log(`\nDiscovered ${files.length} files\n`);

    if (files.length === 0) {
      console.log('No files to index');
      stats.durationMs = Date.now() - startTime;
      return stats;
    }

    // Stage 4: Process files with progress bar
    const allChunks: ChunkRow[] = [];
    const progressBar = new cliProgress.SingleBar(
      {
        format: 'Indexing | {bar} | {percentage}% | {value}/{total} files | {chunksCount} chunks',
      },
      cliProgress.Presets.shades_classic,
    );

    progressBar.start(files.length, 0, { chunksCount: 0 });

    for (const filePath of files) {
      try {
        // Detect language from file extension
        const ext = filePath.substring(filePath.lastIndexOf('.'));
        const parserCache = parserMap.get(ext);

        if (!parserCache) {
          // No parser for this extension - skip silently
          stats.filesProcessed++;
          progressBar.increment(1, { chunksCount: allChunks.length });
          continue;
        }

        // Read file content
        const content = await readFile(filePath, 'utf-8');

        // Chunk the file
        const chunks = await chunkCodeFile(filePath, content, parserCache);

        // Convert to ChunkRow format for database
        for (const chunk of chunks) {
          allChunks.push({
            filePath: chunk.filePath,
            symbolName: chunk.symbolName,
            symbolType: chunk.symbolType,
            content: chunk.content,
            contentHash: chunk.contentHash,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            language: chunk.language,
          });
        }

        stats.filesProcessed++;
        progressBar.increment(1, { chunksCount: allChunks.length });
      } catch (error) {
        // Log warning but continue processing remaining files
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`\nWarning: Failed to process ${filePath}: ${errorMsg}`);
        stats.filesFailed++;
        progressBar.increment(1, { chunksCount: allChunks.length });
      }
    }

    progressBar.stop();
    console.log('\n');

    // Stage 5: Persist chunks to database
    if (allChunks.length > 0) {
      const persistSpinner = new cliProgress.SingleBar(
        {
          format: 'Persisting {chunksCount} chunks to database... {bar}',
        },
        cliProgress.Presets.shades_classic,
      );
      persistSpinner.start(1, 0, { chunksCount: allChunks.length });

      insertChunksBatch(db, allChunks);
      stats.chunksCreated = allChunks.length;

      persistSpinner.update(1);
      persistSpinner.stop();
      console.log('\n');
    }

    // Stage 6: Build search indices (BM25 + Vector)
    if (allChunks.length > 0) {
      console.log('Building search indices...');

      // Build BM25 index
      const bm25Spinner = new cliProgress.SingleBar(
        {
          format: 'BM25 index... {bar}',
        },
        cliProgress.Presets.shades_classic,
      );
      bm25Spinner.start(1, 0);

      const bm25Index = await buildBM25Index(db);
      await saveBM25Index(bm25Index, '.oracle/bm25.msp');

      bm25Spinner.update(1);
      bm25Spinner.stop();
      console.log('✓ BM25 index saved\n');

      // Build vector index with embeddings
      console.log('Computing embeddings... (this may take 30-60 seconds)');
      const vectorSpinner = new cliProgress.SingleBar(
        {
          format: 'Embeddings... {bar} | {value}/{total} chunks',
        },
        cliProgress.Presets.shades_classic,
      );
      vectorSpinner.start(allChunks.length, 0);

      const embedder = await initEmbedder();
      const vectorIndex = await buildVectorIndex(db, embedder, (current: number) => {
        vectorSpinner.update(current);
      });

      vectorSpinner.stop();
      console.log('✓ Embeddings computed\n');

      // Save vector index
      const indexSpinner = new cliProgress.SingleBar(
        {
          format: 'Vector index... {bar}',
        },
        cliProgress.Presets.shades_classic,
      );
      indexSpinner.start(1, 0);

      await saveVectorIndex(vectorIndex, DEFAULT_VECTOR_INDEX_PATH);

      indexSpinner.update(1);
      indexSpinner.stop();
      console.log('✓ Vector index saved\n');
    }

    // Stage 7: Return statistics
    stats.durationMs = Date.now() - startTime;
    return stats;
  } finally {
    // Always close database connection
    if (db) {
      db.close();
    }
  }
}

/**
 * Performs incremental repository update.
 *
 * Uses git diff to detect changed files, compares content hashes with existing chunks,
 * re-indexes only files that have actually changed, and updates the database.
 *
 * @param options - Indexing configuration (must have incremental: true)
 * @returns Statistics about the update operation
 * @throws Error if not a git repository or database operations fail
 */
export async function updateRepository(options: IndexOptions): Promise<IndexStats> {
  const startTime = Date.now();
  const stats: IndexStats = {
    filesDiscovered: 0,
    filesProcessed: 0,
    filesFailed: 0,
    chunksCreated: 0,
    durationMs: 0,
  };

  let db: Database.Database | null = null;

  try {
    // Stage 1: Initialize database
    console.log('Initializing database...');
    db = initDatabase(options.dbPath);
    runMigrations(db);

    // Stage 2: Detect changed files via git
    console.log('Detecting changed files via git...');
    const git = simpleGit(options.repoPath);

    let changedFilePaths: string[] = [];
    try {
      const diffSummary = await git.diffSummary(['HEAD']);
      changedFilePaths = diffSummary.files.map((f: { file: string }) => f.file);
      console.log(`Git detected ${changedFilePaths.length} changed files`);
    } catch {
      console.warn(
        'Warning: Failed to get git diff - this may not be a git repository or git is not available',
      );
      console.warn('Falling back to full index mode');
      // Fallback to full index if git fails
      if (db) {
        db.close();
      }
      return indexRepository({ ...options, incremental: false });
    }

    if (changedFilePaths.length === 0) {
      console.log('No changes detected');
      stats.durationMs = Date.now() - startTime;
      return stats;
    }

    // Stage 3: Initialize language parsers
    const spinner = new cliProgress.SingleBar(
      {
        format: 'Initializing parsers... {bar}',
      },
      cliProgress.Presets.shades_classic,
    );
    spinner.start(3, 0);

    const parserMap = new Map<string, ParserCache>();

    const tsParser = await initParser(typescriptQueryConfig);
    for (const ext of typescriptQueryConfig.extensions) {
      parserMap.set(ext, tsParser);
    }
    spinner.increment();

    const jsParser = await initParser(javascriptQueryConfig);
    for (const ext of javascriptQueryConfig.extensions) {
      parserMap.set(ext, jsParser);
    }
    spinner.increment();

    const pyParser = await initParser(pythonQueryConfig);
    for (const ext of pythonQueryConfig.extensions) {
      parserMap.set(ext, pyParser);
    }
    spinner.increment();

    spinner.stop();
    console.log('Parsers initialized\n');

    // Stage 4: Compare content hashes to identify files needing re-indexing
    const filesToReindex: string[] = [];

    for (const relPath of changedFilePaths) {
      const absolutePath = `${options.repoPath}/${relPath}`.replace(/\\/g, '/');

      try {
        // Read current content
        const content = await readFile(absolutePath, 'utf-8');
        const currentHash = hashContent(content);

        // Get existing chunks from database
        const existingChunks = getChunksByFile(db, absolutePath);

        // Check if any chunk has a different hash (file was modified)
        const needsReindex =
          existingChunks.length === 0 ||
          existingChunks.some((chunk) => chunk.contentHash !== currentHash);

        if (needsReindex) {
          filesToReindex.push(absolutePath);
        }
      } catch {
        // File might have been deleted or is inaccessible - skip
        console.warn(`Warning: Cannot access ${relPath}, skipping`);
      }
    }

    stats.filesDiscovered = filesToReindex.length;
    console.log(`${filesToReindex.length} files need re-indexing\n`);

    if (filesToReindex.length === 0) {
      console.log('No files to update');
      stats.durationMs = Date.now() - startTime;
      return stats;
    }

    // Stage 5: Delete old chunks for changed files
    for (const filePath of filesToReindex) {
      deleteChunksByFile(db, filePath);
    }

    // Stage 6: Re-index changed files
    const allChunks: ChunkRow[] = [];
    const progressBar = new cliProgress.SingleBar(
      {
        format:
          'Re-indexing | {bar} | {percentage}% | {value}/{total} files | {chunksCount} chunks',
      },
      cliProgress.Presets.shades_classic,
    );

    progressBar.start(filesToReindex.length, 0, { chunksCount: 0 });

    for (const filePath of filesToReindex) {
      try {
        // Detect language from file extension
        const ext = filePath.substring(filePath.lastIndexOf('.'));
        const parserCache = parserMap.get(ext);

        if (!parserCache) {
          stats.filesProcessed++;
          progressBar.increment(1, { chunksCount: allChunks.length });
          continue;
        }

        // Read file content
        const content = await readFile(filePath, 'utf-8');

        // Chunk the file
        const chunks = await chunkCodeFile(filePath, content, parserCache);

        // Convert to ChunkRow format
        for (const chunk of chunks) {
          allChunks.push({
            filePath: chunk.filePath,
            symbolName: chunk.symbolName,
            symbolType: chunk.symbolType,
            content: chunk.content,
            contentHash: chunk.contentHash,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            language: chunk.language,
          });
        }

        stats.filesProcessed++;
        progressBar.increment(1, { chunksCount: allChunks.length });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`\nWarning: Failed to process ${filePath}: ${errorMsg}`);
        stats.filesFailed++;
        progressBar.increment(1, { chunksCount: allChunks.length });
      }
    }

    progressBar.stop();
    console.log('\n');

    // Stage 7: Persist new chunks
    if (allChunks.length > 0) {
      const persistSpinner = new cliProgress.SingleBar(
        {
          format: 'Persisting {chunksCount} chunks to database... {bar}',
        },
        cliProgress.Presets.shades_classic,
      );
      persistSpinner.start(1, 0, { chunksCount: allChunks.length });

      insertChunksBatch(db, allChunks);
      stats.chunksCreated = allChunks.length;

      persistSpinner.update(1);
      persistSpinner.stop();
      console.log('\n');
    }

    // Stage 8: Return statistics
    stats.durationMs = Date.now() - startTime;
    return stats;
  } finally {
    if (db) {
      db.close();
    }
  }
}
