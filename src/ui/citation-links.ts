/**
 * Clickable file citations with OSC 8 hyperlinks.
 *
 * Renders file paths as clickable links using terminal-link with OSC 8 protocol.
 * Works in VS Code terminal, iTerm2, Windows Terminal, and other modern terminals.
 * Gracefully falls back to plain dim text in unsupported terminals.
 *
 * Features:
 * - file:// URLs with line numbers for IDE integration
 * - Blue arrow visual separator
 * - Automatic graceful degradation
 * - Absolute path resolution from project root
 */

import terminalLink from 'terminal-link';
import chalk from 'chalk';
import path from 'path';

/**
 * Render clickable file citation with line number.
 *
 * Creates OSC 8 hyperlink with file:// URL pointing to specific line.
 * Clicking link in supported terminals opens file in default editor at that line.
 *
 * Display format: `→ path/to/file.ts:123` (with clickable link)
 * Fallback format: `→ path/to/file.ts:123` (dim text, no link)
 *
 * Supported terminals:
 * - VS Code integrated terminal
 * - iTerm2 (macOS)
 * - Windows Terminal
 * - GNOME Terminal (Linux)
 *
 * @param filePath - Relative file path from project root
 * @param line - Line number to link to
 * @param projectRoot - Absolute path to project root (defaults to cwd)
 * @returns Formatted citation with clickable link (or plain text fallback)
 *
 * @example
 * ```typescript
 * const citation = renderCitation('src/api/auth.ts', 42, process.cwd());
 * console.log(citation);
 * // In supported terminal: clickable "→ src/api/auth.ts:42"
 * // In basic terminal: dim "→ src/api/auth.ts:42"
 * ```
 */
export function renderCitation(
  filePath: string,
  line: number,
  projectRoot: string = process.cwd(),
): string {
  // Build absolute path for file:// URL
  const absolutePath = path.resolve(projectRoot, filePath);

  // Create file:// URL with line number
  // Format: file:///absolute/path/to/file.ts:123
  // Many editors (VS Code, etc.) recognize this format and jump to line
  const fileUrl = `file://${absolutePath}:${line}`;

  // Display text: relative path with line number
  const displayText = `${filePath}:${line}`;

  // Create hyperlink with graceful fallback
  // terminal-link auto-detects support and returns fallback text if unsupported
  const link = terminalLink(displayText, fileUrl, {
    fallback: (text) => chalk.dim(text),
  });

  // Add blue arrow visual separator (Phase 5 pattern: blue for info)
  return `${chalk.blue('→')} ${link}`;
}
