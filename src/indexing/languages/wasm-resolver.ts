import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Resolves WASM file paths to absolute paths based on the package installation directory.
 *
 * CRITICAL: Tree-sitter WASM files must be loaded using absolute paths because
 * Parser.Language.load() resolves relative paths from the user's CWD, not from
 * the oracle package installation directory.
 *
 * This function converts relative paths (e.g., 'node_modules/tree-sitter-wasms/...')
 * to absolute paths by resolving them relative to the GitQA package root.
 *
 * @param relativePath - Relative path from package root to WASM file
 * @returns Absolute path to WASM file
 */
export function resolveWasmPath(relativePath: string): string {
  // Get the directory of the current module file
  // import.meta.url is like: file:///C:/path/to/GitQA/dist/indexing/languages/wasm-resolver.js
  const currentModulePath = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentModulePath);

  // Navigate up to package root: dist/indexing/languages -> dist/indexing -> dist -> root
  // In dev (src): src/indexing/languages -> src/indexing -> src -> root
  // In prod (dist): dist/indexing/languages -> dist/indexing -> dist -> root
  const packageRoot = join(currentDir, '../../..');

  // Resolve relative path from package root
  return join(packageRoot, relativePath);
}
