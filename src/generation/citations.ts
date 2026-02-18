/**
 * Citation extraction and validation for LLM responses.
 *
 * Extracts citations in [file.ts:10-20] format from LLM responses and
 * validates them against retrieved chunks to detect hallucination.
 *
 * CRITICAL: LLMs can hallucinate file paths and line numbers.
 * Always validate citations against retrieved chunks to ensure accuracy.
 *
 * Pattern from Phase 4 research (Pattern 5: Citation Extraction):
 * - Parse citations using regex
 * - Validate against retrieved chunks
 * - Warn on invalid citations (transparency for users)
 */

import type { SearchResult } from '../search/search.js';

/**
 * Parsed citation from LLM response.
 */
export interface Citation {
  /** Path to source file */
  filePath: string;
  /** Starting line number */
  startLine: number;
  /** Optional ending line number (if range like [file:10-20]) */
  endLine?: number;
  /** Raw citation text as it appeared in response */
  rawText: string;
}

/**
 * Extract citations from LLM response text.
 *
 * Citation format: [file.ts:10-20] or [file.ts:15]
 * - File path can include directories: [src/auth/login.ts:10-20]
 * - Single line: [file.ts:10]
 * - Line range: [file.ts:10-20]
 *
 * Process:
 * 1. Find all matches using citation regex
 * 2. Parse each match into Citation object
 * 3. Return array of citations (may be empty if no citations found)
 *
 * Edge cases:
 * - No citations: Returns empty array (valid - some answers may not need citations)
 * - Malformed brackets: Ignored (regex won't match)
 * - Invalid line numbers: Still extracted (validation happens in validateCitations)
 * - Duplicate citations: All extracted (no deduplication)
 *
 * @param response - Full LLM response text
 * @returns Array of parsed citations (empty if none found)
 *
 * @example
 * ```typescript
 * const response = "The auth is in [src/auth.ts:10-20] and uses [config.ts:5]";
 * const citations = extractCitations(response);
 * // [
 * //   { filePath: 'src/auth.ts', startLine: 10, endLine: 20, rawText: '[src/auth.ts:10-20]' },
 * //   { filePath: 'config.ts', startLine: 5, endLine: undefined, rawText: '[config.ts:5]' }
 * // ]
 * ```
 */
export function extractCitations(response: string): Citation[] {
  // Citation regex: [file.ts:10-20] or [file.ts:10]
  // Pattern breakdown:
  // - \[ - Opening bracket (escaped)
  // - ([^\]]+) - Capture file path (anything except closing bracket)
  // - : - Colon separator
  // - (\d+) - Capture start line number (one or more digits)
  // - (?:-(\d+))? - Optional: dash followed by end line number
  // - \] - Closing bracket (escaped)
  // - /g - Global flag (find all matches)
  const citationRegex = /\[([^\]]+):(\d+)(?:-(\d+))?\]/g;

  const citations: Citation[] = [];
  let match: RegExpExecArray | null;

  // Use exec() in loop to get all matches with capture groups
  while ((match = citationRegex.exec(response)) !== null) {
    const [rawText, filePath, startLineStr, endLineStr] = match;

    const startLine = parseInt(startLineStr, 10);
    const endLine = endLineStr ? parseInt(endLineStr, 10) : undefined;

    citations.push({
      filePath,
      startLine,
      endLine,
      rawText,
    });
  }

  return citations;
}

/**
 * Validate citations against retrieved chunks to detect hallucination.
 *
 * For each citation, checks if it exists in the retrieved chunks:
 * - Match by file path (exact string match)
 * - Match by line range (citation range must be within chunk range)
 *
 * Validation logic:
 * - Citation is valid if: chunk.filePath === citation.filePath AND
 *   chunk.startLine <= citation.startLine AND
 *   chunk.endLine >= citation.endLine (or citation.startLine if no endLine)
 *
 * Why validate (per research pitfall #4):
 * - LLMs can hallucinate file paths that don't exist
 * - LLMs can cite line numbers outside retrieved chunks
 * - Validation provides transparency to users about answer accuracy
 * - Helps debug prompt engineering issues
 *
 * Edge cases:
 * - No citations: Returns true (valid - empty set is vacuously valid)
 * - Citation points to wrong file: Logs warning, returns false
 * - Citation points to wrong line range: Logs warning, returns false
 * - Multiple invalid citations: Logs all warnings, returns false
 *
 * @param citations - Array of citations from extractCitations()
 * @param chunks - Array of retrieved chunks from hybrid search
 * @returns true if all citations are valid, false if any are invalid
 *
 * @example
 * ```typescript
 * const citations = extractCitations(response);
 * const valid = validateCitations(citations, chunks);
 * if (!valid) {
 *   console.log('⚠️  Some citations may be inaccurate.');
 * }
 * ```
 */
export function validateCitations(citations: Citation[], chunks: SearchResult[]): boolean {
  // Edge case: no citations (valid - some answers may not need citations)
  if (citations.length === 0) {
    return true;
  }

  let allValid = true;

  for (const citation of citations) {
    // Find matching chunk
    const matchingChunk = chunks.find((chunk) => {
      // Must match file path exactly
      if (chunk.filePath !== citation.filePath) {
        return false;
      }

      // Citation line range must be within chunk line range
      // If citation has endLine, check range; otherwise just check startLine
      const citationEnd = citation.endLine ?? citation.startLine;

      // Chunk must contain the entire citation range
      return chunk.startLine <= citation.startLine && chunk.endLine >= citationEnd;
    });

    if (!matchingChunk) {
      // Invalid citation - LLM hallucinated this reference
      console.warn(`⚠️  Invalid citation: ${citation.rawText} not found in retrieved chunks`);
      allValid = false;
    }
  }

  return allValid;
}
