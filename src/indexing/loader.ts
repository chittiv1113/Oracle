import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import { existsSync, statSync } from 'fs';
import { createIgnoreFilter, shouldIgnorePath, isBinaryFile } from './filters.js';
import type { Ignore } from 'ignore';

/**
 * Configuration for file discovery and filtering
 */
export interface FileFilterConfig {
  /** Maximum file size in bytes before skipping (default: 500KB) */
  maxFileSizeBytes: number;
  /** Generated/build directories to always exclude */
  generatedDirs: string[];
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: FileFilterConfig = {
  maxFileSizeBytes: 500 * 1024, // 500KB
  generatedDirs: ['node_modules/', 'dist/', 'build/'],
};

/**
 * Discovers all valid code files in a repository, applying multiple filtering stages:
 * 1. Validates repository path exists
 * 2. Loads and applies .gitignore rules
 * 3. Recursively traverses directory tree
 * 4. Filters by file size (skips large files)
 * 5. Filters binary files
 *
 * @param repoPath - Absolute path to repository root
 * @param config - Optional partial configuration (merged with defaults)
 * @returns Array of absolute file paths that passed all filters, sorted alphabetically
 * @throws Error if repoPath is invalid or inaccessible
 */
export async function discoverFiles(
  repoPath: string,
  config?: Partial<FileFilterConfig>,
): Promise<string[]> {
  // Merge config with defaults
  const fullConfig: FileFilterConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  // Stage 1: Validate repository path
  if (!existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  const repoStat = statSync(repoPath);
  if (!repoStat.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repoPath}`);
  }

  // Stage 2: Initialize ignore filter
  let ignoreFilter: Ignore;
  try {
    ignoreFilter = await createIgnoreFilter(repoPath);
  } catch (error) {
    console.warn(`Warning: Failed to create ignore filter, continuing without: ${error}`);
    // Create empty ignore instance as fallback
    const ignoreModule = await import('ignore');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ignoreFilter = (ignoreModule as any).default();
  }

  // Stage 3: Recursive file traversal
  const candidateFiles: string[] = [];

  async function traverse(currentPath: string): Promise<void> {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);

        // Check if path should be ignored
        if (shouldIgnorePath(ignoreFilter, fullPath, repoPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          // Recurse into subdirectory
          await traverse(fullPath);
        } else if (entry.isFile()) {
          // Add to candidates
          candidateFiles.push(fullPath);
        }
        // Skip symlinks, sockets, etc.
      }
    } catch (error) {
      // Gracefully handle permission errors
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        console.warn(`Warning: Permission denied accessing ${currentPath}, skipping`);
      } else {
        console.warn(`Warning: Error reading directory ${currentPath}: ${err.message}`);
      }
    }
  }

  await traverse(repoPath);

  // Stage 4: Apply size and binary filters
  const filteredFiles: string[] = [];

  for (const filePath of candidateFiles) {
    try {
      // Check file size
      const fileStat = await stat(filePath);
      if (fileStat.size > fullConfig.maxFileSizeBytes) {
        const relativePath = relative(repoPath, filePath);
        console.warn(`Skipping large file (${fileStat.size} bytes): ${relativePath}`);
        continue;
      }

      // Check if binary
      const isBinary = await isBinaryFile(filePath);
      if (isBinary) {
        // Skip silently - many binary files are expected
        continue;
      }

      // File passed all filters
      filteredFiles.push(filePath);
    } catch (error) {
      // Handle errors for individual files gracefully
      const err = error as Error;
      console.warn(`Warning: Error checking file ${filePath}: ${err.message}`);
    }
  }

  // Stage 5: Sort and return
  const sortedFiles = filteredFiles.sort();

  // Optional: Log summary
  console.log(`Discovered ${sortedFiles.length} files in ${repoPath}`);

  return sortedFiles;
}
