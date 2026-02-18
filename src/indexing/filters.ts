import { isBinaryFile as detectBinary } from 'isbinaryfile';
import * as ignoreModule from 'ignore';
import type { Ignore, Options } from 'ignore';
import { readFile } from 'fs/promises';
import { join, relative } from 'path';
import { existsSync } from 'fs';

// TypeScript with verbatimModuleSyntax needs explicit type assertion for CommonJS default export
const ignoreLib = (ignoreModule as unknown as { default: (options?: Options) => Ignore }).default;

/**
 * Re-export binary file detection utility with type annotations
 */
export const isBinaryFile = detectBinary;

/**
 * Creates an ignore filter instance that respects .gitignore patterns
 * and includes hardcoded exclusion patterns for common generated directories.
 *
 * @param repoPath - Absolute path to the repository root
 * @returns Configured ignore instance
 */
export async function createIgnoreFilter(repoPath: string): Promise<Ignore> {
  const ig = ignoreLib();

  // Add hardcoded patterns for common generated/unnecessary directories
  ig.add(['node_modules/', 'dist/', 'build/', '.git/', '*.min.js']);

  // Load .gitignore file if it exists
  const gitignorePath = join(repoPath, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      const gitignoreContent = await readFile(gitignorePath, 'utf-8');
      ig.add(gitignoreContent);
    } catch (error) {
      // Gracefully handle read errors (permissions, etc.)
      // Continue with just hardcoded patterns
      console.warn(`Warning: Could not read .gitignore file: ${error}`);
    }
  }

  return ig;
}

/**
 * Determines if a file path should be ignored based on ignore patterns.
 *
 * CRITICAL: The ignore library requires relative paths WITHOUT leading `./`
 *
 * @param ignoreInstance - Configured ignore instance from createIgnoreFilter
 * @param filePath - Absolute or relative file path to check
 * @param repoRoot - Repository root path for computing relative paths
 * @returns true if the path should be ignored, false otherwise
 */
export function shouldIgnorePath(
  ignoreInstance: Ignore,
  filePath: string,
  repoRoot: string,
): boolean {
  // Use path.relative to properly compute relative path (handles all OS path formats)
  const relativePath = relative(repoRoot, filePath);

  // Normalize to forward slashes for ignore library (it expects POSIX-style paths)
  const normalizedPath = relativePath.replace(/\\/g, '/');

  return ignoreInstance.ignores(normalizedPath);
}
