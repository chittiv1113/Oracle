import { Command } from 'commander';
import { updateRepository } from '../../indexing/indexer.js';
import chalk from 'chalk';
import { ResponseCache } from '../../generation/cache.js';

export const updateCommand = new Command('update')
  .description('Update the index with recent changes')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('--db <path>', 'Database path', '.oracle/index.db')
  .option('--max-size <kb>', 'Max file size in KB', '500')
  .addHelpText(
    'after',
    `

Examples:
  # Update index after code changes
  $ oracle update

  # Update specific repository
  $ oracle update --path /path/to/repo

Notes:
  - Shorthand for 'oracle index update'
  - Only re-indexes changed files
`,
  )
  .action(async (options) => {
    const maxFileSizeBytes = parseInt(options.maxSize, 10) * 1024;

    console.log(chalk.blue(`Updating index for: ${options.path}\n`));

    try {
      const stats = await updateRepository({
        repoPath: options.path,
        dbPath: options.db,
        incremental: true,
        maxFileSizeBytes,
      });

      console.log(chalk.green('\n✅ Update complete!'));
      console.log(`Files re-indexed: ${stats.filesProcessed}`);
      console.log(`Chunks updated: ${stats.chunksCreated}`);
      console.log(`Duration: ${(stats.durationMs / 1000).toFixed(2)}s`);

      // Clear response cache after index update
      const cache = new ResponseCache();
      await cache.clear();
      console.log(chalk.dim('💾 Response cache cleared'));
    } catch (error) {
      console.error(
        chalk.red('❌ Update failed:'),
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });
