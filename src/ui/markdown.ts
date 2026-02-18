/**
 * Terminal markdown rendering with syntax highlighting.
 *
 * Renders markdown content for terminal display using marked + marked-terminal.
 * Uses cli-highlight (via marked-terminal) for syntax-highlighted code blocks.
 *
 * Features:
 * - Headings, lists, bold, italic, code fences
 * - Syntax-highlighted code blocks with Phase 5 color theme
 * - Graceful handling of empty/null input
 * - Preserves markdown structure in terminal-friendly format
 */

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

/**
 * Render markdown content for terminal display.
 *
 * Parses markdown and renders with terminal-specific formatting:
 * - Headings: bold with visual hierarchy
 * - Lists: indented with bullets
 * - Code blocks: syntax-highlighted via cli-highlight
 * - Inline code: highlighted with background
 * - Links: underlined (clickable if terminal supports it)
 *
 * Uses marked-terminal's built-in cli-highlight integration with custom theme
 * matching Phase 5 semantic colors (blue keywords, green strings, cyan built-ins).
 *
 * @param markdown - Markdown content to render
 * @returns Terminal-formatted markdown with ANSI colors
 *
 * @example
 * ```typescript
 * const markdown = `
 * # Answer
 *
 * The authentication flow works like this:
 *
 * \`\`\`typescript
 * function authenticate(token: string) {
 *   return verify(token);
 * }
 * \`\`\`
 * `;
 *
 * const rendered = renderMarkdown(markdown);
 * console.log(rendered);
 * // Displays formatted markdown with syntax-highlighted code
 * ```
 */
export function renderMarkdown(markdown: string): string {
  // Handle empty/null input gracefully
  if (!markdown || markdown.trim() === '') {
    return '';
  }

  // Configure marked with terminal renderer
  // Use setOptions API for compatibility
  // Type assertion needed because @types/marked-terminal types don't match current marked
  // TerminalRenderer extends Renderer but the type definitions are outdated
  marked.setOptions({
    renderer: markedTerminal({
      // Override default styles to match Phase 5 patterns
      code: chalk.yellow, // Code blocks background color
      codespan: chalk.yellow, // Inline code color
      heading: chalk.green.bold, // Headings in green (matches Phase 5 success color)
      link: chalk.blue, // Links in blue (matches Phase 5 info color)
    }) as unknown as typeof marked.defaults.renderer,
  });

  // Parse and render markdown
  // marked.parse returns string (not Promise) in sync mode
  const rendered = marked.parse(markdown, { async: false }) as string;

  return rendered;
}
