/**
 * Code syntax highlighting for terminal output.
 *
 * Provides syntax-highlighted code blocks using cli-highlight with
 * custom theme matching Phase 5 semantic colors (blue keywords, green strings).
 *
 * Features:
 * - Explicit language parameter (more reliable than auto-detection)
 * - Graceful degradation for unknown languages
 * - Custom theme using chalk colors from Phase 5
 * - Language label above code block
 */

import { highlight } from 'cli-highlight';
import chalk from 'chalk';

/**
 * Render code block with syntax highlighting.
 *
 * Uses cli-highlight with explicit language parameter for reliable highlighting.
 * Falls back gracefully to plain code if highlighting fails or language is unknown.
 *
 * Custom theme matches Phase 5 patterns:
 * - Keywords: blue (chalk.blue)
 * - Built-ins: cyan (chalk.cyan)
 * - Strings: green (chalk.green)
 * - Comments: dim (chalk.dim)
 *
 * @param code - Code content to highlight
 * @param language - Programming language (e.g., 'typescript', 'python', 'javascript')
 * @returns Syntax-highlighted code with language label
 *
 * @example
 * ```typescript
 * const code = 'function hello() { return "world"; }';
 * const highlighted = renderCodeBlock(code, 'javascript');
 * console.log(highlighted);
 * // Displays syntax-highlighted JavaScript with color
 * ```
 */
export function renderCodeBlock(code: string, language: string): string {
  // Add language label above code block (dim, unobtrusive)
  const label = chalk.dim(`Language: ${language}`);

  try {
    // Custom theme matching Phase 5 semantic colors
    const theme = {
      keyword: chalk.blue,
      built_in: chalk.cyan,
      string: chalk.green,
      comment: chalk.dim,
    };

    // Highlight with explicit language parameter
    // cli-highlight throws on unknown languages, so we catch and fall back
    const highlighted = highlight(code, {
      language,
      theme,
    });

    return `${label}\n${highlighted}`;
  } catch {
    // Graceful fallback for unknown languages or highlighting errors
    // Return plain code without colors (better than crashing)
    return `${label}\n${code}`;
  }
}
