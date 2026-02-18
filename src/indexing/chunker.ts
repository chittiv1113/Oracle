/**
 * AST-based code chunking using web-tree-sitter.
 *
 * Parses code files into syntactically-complete chunks (functions, classes, methods)
 * with metadata and content hashing for incremental indexing.
 */

import Parser from 'web-tree-sitter';
import { hashContent } from './hasher.js';

/**
 * Configuration for tree-sitter language query patterns.
 */
export interface QueryConfig {
  language: string;
  extensions: string[];
  wasmPath: string;
  queryString: string;
}

/**
 * Metadata for a code chunk.
 */
export interface CodeChunk {
  content: string;
  contentHash: string;
  symbolName: string | null;
  symbolType: 'function' | 'class' | 'method' | 'unknown';
  startLine: number;
  endLine: number;
  language: string;
  filePath: string;
}

/**
 * Cached parser instance with compiled query.
 */
export interface ParserCache {
  parser: Parser;
  language: Parser.Language;
  query: Parser.Query;
  config: QueryConfig;
}

/**
 * Initializes a tree-sitter parser for a specific language.
 *
 * CRITICAL: Call Parser.init() once before first use to load WASM.
 * Pre-compiles queries for performance (do NOT recompile per file).
 *
 * @param config - Language-specific query configuration
 * @returns Cached parser instance with compiled query
 */
export async function initParser(config: QueryConfig): Promise<ParserCache> {
  // Initialize WASM runtime (idempotent - safe to call multiple times)
  await Parser.init();

  // Load language grammar from WASM file
  const language = await Parser.Language.load(config.wasmPath);

  // Create parser instance
  const parser = new Parser();
  parser.setLanguage(language);

  // Pre-compile query (major performance optimization)
  const query = language.query(config.queryString);

  return {
    parser,
    language,
    query,
    config,
  };
}

/**
 * Determines symbol type from capture name.
 *
 * @param captureName - Name of the tree-sitter capture (e.g., "function", "class")
 * @returns Symbol type enum value
 */
function determineSymbolType(captureName: string): 'function' | 'class' | 'method' | 'unknown' {
  if (captureName === 'function') return 'function';
  if (captureName === 'class') return 'class';
  if (captureName === 'method') return 'method';
  return 'unknown';
}

/**
 * Extracts symbol name from query match captures.
 *
 * Looks for name captures like @func_name, @class_name, @method_name.
 *
 * @param captures - Array of captures from query match
 * @returns Symbol name or null if not found
 */
function extractSymbolName(captures: Parser.QueryCapture[]): string | null {
  const nameCapture = captures.find((c) =>
    ['func_name', 'class_name', 'method_name'].includes(c.name),
  );
  return nameCapture ? nameCapture.node.text : null;
}

/**
 * Chunks a code file into syntactically-complete AST nodes.
 *
 * Parses the file using tree-sitter, executes pre-compiled queries to extract
 * functions/classes/methods, and captures metadata for each chunk.
 *
 * @param filePath - Path to the code file (for metadata)
 * @param content - File content as string
 * @param parserCache - Cached parser with pre-compiled query
 * @returns Array of code chunks with metadata
 */
export async function chunkCodeFile(
  filePath: string,
  content: string,
  parserCache: ParserCache,
): Promise<CodeChunk[]> {
  const chunks: CodeChunk[] = [];

  try {
    // Parse content into AST
    const tree = parserCache.parser.parse(content);

    // Check for parse errors
    if (tree.rootNode.hasError) {
      console.warn(`Warning: Parse errors in ${filePath} - extracting partial results`);
    }

    // Execute pre-compiled query to find functions/classes/methods
    const matches = parserCache.query.matches(tree.rootNode);

    // Extract chunks from matches
    for (const match of matches) {
      // Find the main capture (function, class, or method node)
      const mainCapture = match.captures.find((c) =>
        ['function', 'class', 'method'].includes(c.name),
      );

      if (!mainCapture) continue;

      const node = mainCapture.node;

      // Extract symbol name from name captures
      const symbolName = extractSymbolName(match.captures);

      // Determine symbol type from capture name
      const symbolType = determineSymbolType(mainCapture.name);

      // Get line range (1-indexed)
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;

      // Extract content
      const chunkContent = node.text;

      // Compute content hash
      const contentHash = hashContent(chunkContent);

      chunks.push({
        content: chunkContent,
        contentHash,
        symbolName,
        symbolType,
        startLine,
        endLine,
        language: parserCache.config.language,
        filePath,
      });
    }
  } catch (error) {
    console.warn(
      `Warning: Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }

  return chunks;
}
