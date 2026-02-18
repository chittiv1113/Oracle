/**
 * Multi-provider token counting for smart context optimization.
 *
 * Provides accurate token counting for Anthropic, OpenAI, and Ollama
 * to determine if RAG can be bypassed for small repositories.
 *
 * Small repositories (<50K tokens) benefit from sending full codebase
 * directly to LLM instead of using RAG approximation.
 */

import { countTokens } from '@anthropic-ai/tokenizer';
import { encodingForModel } from 'js-tiktoken';
import type Database from 'better-sqlite3';
import ora from 'ora';
import type { LLMProvider } from './types.js';

/**
 * Chunk row from database with content and metadata.
 */
interface ChunkRow {
  content: string;
  language: string;
}

/**
 * Result of RAG bypass analysis.
 */
export interface BypassAnalysis {
  /** Whether to bypass RAG and send full codebase */
  bypass: boolean;

  /** Total token count for codebase */
  tokenCount: number;

  /** Full codebase text (only if bypass is true) */
  fullText?: string;
}

/**
 * Counts tokens for text using provider-specific tokenizer.
 *
 * Uses official tokenizers for accuracy:
 * - Anthropic: @anthropic-ai/tokenizer (billing-grade accuracy)
 * - OpenAI: js-tiktoken (matches OpenAI's tiktoken)
 * - Ollama: Conservative estimation (chars/4, safe approximation)
 *
 * @param text - Text to count tokens for
 * @param provider - LLM provider name
 * @param model - Model name for provider-specific tokenizer
 * @returns Token count
 *
 * @example
 * ```typescript
 * const tokens = await countTokensForProvider(
 *   codeText,
 *   'anthropic',
 *   'claude-sonnet-4-5-20250929'
 * );
 * ```
 */
export async function countTokensForProvider(
  text: string,
  provider: string,
  model: string,
): Promise<number> {
  try {
    if (provider === 'Anthropic') {
      // Use official Anthropic tokenizer
      return countTokens(text);
    }

    if (provider === 'OpenAI') {
      // Use js-tiktoken for OpenAI models
      const enc = encodingForModel(model as 'gpt-4o');
      const tokens = enc.encode(text).length;
      return tokens;
    }

    // Ollama or unknown provider - use conservative estimation
    // Research shows ~4 chars per token is safe approximation
    return Math.ceil(text.length / 4);
  } catch (error) {
    // If tokenizer fails, return conservative high estimate
    // to avoid accidental bypass (text.length / 3 is safer than / 4)
    console.error(
      `Token counting failed for ${provider}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return Math.ceil(text.length / 3);
  }
}

/**
 * Analyzes codebase size to determine if RAG should be bypassed.
 *
 * For small repositories (<50K tokens), sending full codebase to LLM
 * provides better accuracy than RAG approximation. Modern LLMs support
 * 200K+ token context windows, making this feasible.
 *
 * Process:
 * 1. Load all chunks from database
 * 2. Build full codebase text
 * 3. Count tokens using provider-specific tokenizer
 * 4. Compare to threshold
 *
 * @param db - Database instance with chunks table
 * @param provider - LLM provider (null if not configured)
 * @param threshold - Token threshold for bypass (default: 50,000)
 * @returns Analysis with bypass decision and token count
 *
 * @example
 * ```typescript
 * const analysis = await shouldBypassRAG(db, provider, 50_000);
 * if (analysis.bypass) {
 *   console.log(`Small codebase (${analysis.tokenCount} tokens)`);
 *   // Send analysis.fullText directly to LLM
 * }
 * ```
 */
export async function shouldBypassRAG(
  db: Database.Database,
  provider: LLMProvider | null,
  threshold: number = 50_000,
): Promise<BypassAnalysis> {
  // No provider = no LLM = no bypass
  if (!provider) {
    return { bypass: false, tokenCount: 0 };
  }

  const spinner = ora('Analyzing codebase size...').start();

  try {
    // Load all chunks from database
    const chunks = db.prepare('SELECT content, language FROM chunks').all() as ChunkRow[];

    if (chunks.length === 0) {
      spinner.stop();
      return { bypass: false, tokenCount: 0 };
    }

    // Build full codebase text with language annotations
    const fullText = chunks.map((c) => `// ${c.language}\n${c.content}`).join('\n\n');

    // Count tokens using provider-specific tokenizer
    const model = (provider.config as { model?: string }).model || '';
    const tokenCount = await countTokensForProvider(fullText, provider.name, model);

    spinner.stop();

    // Compare to threshold
    if (tokenCount < threshold) {
      return { bypass: true, tokenCount, fullText };
    }

    return { bypass: false, tokenCount };
  } catch (error) {
    spinner.stop();
    console.error(
      `Bypass analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    // On error, don't bypass (safer to use RAG than crash)
    return { bypass: false, tokenCount: 0 };
  }
}
