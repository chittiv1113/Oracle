import { Command } from 'commander';
import path from 'path';
import { stat } from 'fs/promises';
import chalk from 'chalk';
import { indexRepository, updateRepository } from '../../indexing/indexer.js';

export const indexCommand = new Command('index')
  .description('Index repository code for Q&A')
  .addCommand(
    new Command('full')
      .description('Perform full repository index')
      .option('-p, --path <path>', 'Repository path', process.cwd())
      .option('--db <path>', 'Database path', '.oracle/index.db')
      .option('--max-size <kb>', 'Max file size in KB', '500')
      .option('--scope <dir>', 'Index only this subdirectory (monorepo support)')
      .addHelpText(
        'after',
        `

Examples:
  # Index current directory
  $ oracle index full

  # Index specific repository
  $ oracle index full --path /path/to/repo

  # Index only a subdirectory (monorepo support)
  $ oracle index full --scope packages/backend

  # Custom database location
  $ oracle index full --db /custom/path/index.db

Notes:
  - Respects .gitignore patterns automatically
  - Skips binary files and files >500KB by default
  - Use --max-size to adjust file size limit
`,
      )
      .action(async (options) => {
        const maxFileSizeBytes = parseInt(options.maxSize, 10) * 1024;

        // Signal handlers for graceful cleanup
        let cleanupHandler: (() => void) | null = null;

        process.on('SIGINT', () => {
          console.log('\n\nInterrupted by user. Cleaning up...');
          if (cleanupHandler) cleanupHandler();
          process.exit(130); // Standard exit code for SIGINT
        });

        process.on('SIGTERM', () => {
          console.log('\n\nTerminated. Cleaning up...');
          if (cleanupHandler) cleanupHandler();
          process.exit(143); // Standard exit code for SIGTERM
        });

        let repoPath = options.path;

        // Validate scope directory if provided
        if (options.scope) {
          const scopePath = path.join(options.path, options.scope);

          // Validate scope exists
          const exists = await stat(scopePath)
            .then(() => true)
            .catch(() => false);

          if (!exists) {
            console.error(chalk.red(`❌ Scope directory not found: ${scopePath}`));
            process.exit(1);
          }

          console.log(chalk.blue(`ℹ️  Indexing scoped directory: ${options.scope}\n`));
          repoPath = scopePath;
        } else {
          console.log(chalk.blue(`ℹ️  Indexing repository: ${repoPath}\n`));
        }

        try {
          cleanupHandler = () => {
            // Cleanup code here if needed (progress bars, etc.)
          };

          const stats = await indexRepository({
            repoPath,
            dbPath: options.db,
            maxFileSizeBytes,
          });

          console.log(chalk.green('\n✅ Indexing complete!'));
          console.log(`Files discovered: ${chalk.bold(stats.filesDiscovered)}`);
          console.log(`Files processed: ${chalk.bold(stats.filesProcessed)}`);
          console.log(`Files failed: ${chalk.bold(stats.filesFailed)}`);
          console.log(`Chunks created: ${chalk.bold(stats.chunksCreated)}`);
          console.log(`Duration: ${chalk.bold((stats.durationMs / 1000).toFixed(2))}s`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(chalk.red('❌ Indexing failed:'), errorMsg);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command('update')
      .description('Incrementally update index (changed files only)')
      .option('-p, --path <path>', 'Repository path', process.cwd())
      .option('--db <path>', 'Database path', '.oracle/index.db')
      .option('--scope <dir>', 'Index only this subdirectory (monorepo support)')
      .addHelpText(
        'after',
        `

Examples:
  # Update index with changed files
  $ oracle index update

  # Update specific repository
  $ oracle index update --path /path/to/repo

  # Update scoped directory
  $ oracle index update --scope packages/frontend

Notes:
  - Only re-indexes files changed since last index
  - Uses git diff to detect changes
  - Falls back to full index if git unavailable
`,
      )
      .action(async (options) => {
        // Signal handlers for graceful cleanup
        let cleanupHandler: (() => void) | null = null;

        process.on('SIGINT', () => {
          console.log('\n\nInterrupted by user. Cleaning up...');
          if (cleanupHandler) cleanupHandler();
          process.exit(130); // Standard exit code for SIGINT
        });

        process.on('SIGTERM', () => {
          console.log('\n\nTerminated. Cleaning up...');
          if (cleanupHandler) cleanupHandler();
          process.exit(143); // Standard exit code for SIGTERM
        });

        let repoPath = options.path;

        // Validate scope directory if provided
        if (options.scope) {
          const scopePath = path.join(options.path, options.scope);

          // Validate scope exists
          const exists = await stat(scopePath)
            .then(() => true)
            .catch(() => false);

          if (!exists) {
            console.error(chalk.red(`❌ Scope directory not found: ${scopePath}`));
            process.exit(1);
          }

          console.log(chalk.blue(`ℹ️  Updating scoped directory: ${options.scope}\n`));
          repoPath = scopePath;
        } else {
          console.log(chalk.blue(`ℹ️  Updating index for: ${repoPath}\n`));
        }

        try {
          cleanupHandler = () => {
            // Cleanup code here if needed (progress bars, etc.)
          };

          const stats = await updateRepository({
            repoPath,
            dbPath: options.db,
            incremental: true,
          });

          console.log(chalk.green('\n✅ Update complete!'));
          console.log(`Files re-indexed: ${chalk.bold(stats.filesProcessed)}`);
          console.log(`Chunks updated: ${chalk.bold(stats.chunksCreated)}`);
          console.log(`Duration: ${chalk.bold((stats.durationMs / 1000).toFixed(2))}s`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(chalk.red('❌ Update failed:'), errorMsg);
          process.exit(1);
        }
      }),
  );
