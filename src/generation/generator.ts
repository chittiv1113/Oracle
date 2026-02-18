/**
 * End-to-end generation pipeline orchestrating RAG flow.
 *
 * Pipeline: Cache lookup → Secret redaction → Prompt building → LLM streaming → Cache write → Citation validation
 *
 * CRITICAL ORDER (per research):
 * 1. Check cache (if enabled)
 * 2. Redact secrets BEFORE building prompt (prepareChunksForAPI)
 * 3. Build prompt with redacted chunks (buildRAGPrompt)
 * 4. Stream LLM response (streamAnthropicResponse)
 * 5. Write to cache (if enabled)
 * 6. Extract and validate citations (extractCitations, validateCitations)
 *
 * NEVER skip secret redaction - chunks must be redacted before external API transmission.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import type { Message as OllamaMessage } from 'ollama';
import chalk from 'chalk';
import type { SearchResult } from '../search/search.js';
import { prepareChunksForAPI } from './secrets.js';
import { buildRAGPrompt } from './prompt.js';
import { streamAnthropicResponse } from './anthropic.js';
import { streamOpenAIResponse } from './openai.js';
import { streamOllamaResponse } from './ollama.js';
import { extractCitations, validateCitations } from './citations.js';
import type { Provider } from './provider-factory.js';
import { ResponseCache } from './cache.js';
import { generateCacheKey } from './cache-key.js';
import { renderCitation } from '../ui/citation-links.js';
import { renderCodeBlock } from '../ui/code-renderer.js';

// Singleton cache instance for response caching
const responseCache = new ResponseCache();

/**
 * Detect programming language from file extension.
 * Used for syntax highlighting in code blocks.
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    java: 'java',
    go: 'go',
    rs: 'rust',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    md: 'markdown',
    sql: 'sql',
  };
  return languageMap[ext || ''] || 'text';
}

/**
 * Generate answer using complete RAG pipeline with caching.
 *
 * Process flow:
 * 1. Cache lookup (if enabled)
 *    - Generate cache key from query + chunks + provider
 *    - Return cached response instantly if found
 *
 * 2. Secret redaction (BEFORE prompt building)
 *    - Call prepareChunksForAPI to redact sensitive patterns
 *    - NEVER use original chunks after this point
 *
 * 3. Prompt construction (using redacted chunks)
 *    - Build XML-structured RAG prompt
 *    - Include chunk metadata for citation
 *
 * 4. Dry-run mode (if enabled)
 *    - Display prompt that would be sent
 *    - Show provider/model/token info
 *    - Return without API call
 *
 * 5. Graceful fallback if client is null
 *    - Display helpful setup message
 *    - Show first 5 retrieved chunks as fallback
 *    - Return early (no API call)
 *
 * 6. LLM streaming (with error handling)
 *    - Stream response token-by-token to terminal
 *    - Handle rate limits, timeouts, network errors
 *
 * 7. Cache write (if enabled and successful)
 *    - Store response in cache for future lookups
 *
 * 8. Citation extraction and validation
 *    - Parse citations from response
 *    - Validate against redacted chunks
 *    - Warn user if citations are invalid
 *
 * Options:
 * - noCache: Skip cache lookup and write (always query LLM)
 * - dryRun: Show prompt without making API call
 *
 * Edge cases:
 * - Cache hit: Return instantly without LLM call
 * - No chunks: Prompt tells LLM to inform user (handled in buildRAGPrompt)
 * - Client is null: Graceful fallback to retrieval-only mode
 * - API errors: User-friendly messages, no stack traces
 * - No citations in response: Valid (not all answers need citations)
 * - Invalid citations: Warning displayed, response still shown
 *
 * @param query - User's question about the codebase
 * @param chunks - Retrieved chunks from hybrid search
 * @param provider - Initialized LLM provider (may be null if unavailable)
 * @param options - Optional flags (noCache, dryRun)
 * @returns Promise resolving when generation complete (output streamed to terminal)
 *
 * @example
 * ```typescript
 * const chunks = await hybridSearch(query, db, bm25Index, vectorIndex, embedder);
 * const provider = initLLMProvider(config);
 *
 * // Normal usage (with caching)
 * await generateAnswer(query, chunks, provider);
 *
 * // Bypass cache
 * await generateAnswer(query, chunks, provider, { noCache: true });
 *
 * // Dry-run mode
 * await generateAnswer(query, chunks, provider, { dryRun: true });
 * ```
 */
export async function generateAnswer(
  query: string,
  chunks: SearchResult[],
  provider: Provider | null,
  options: { noCache?: boolean; dryRun?: boolean; fullCodebase?: string } = {},
): Promise<void> {
  // STEP 0: Small repository bypass (full codebase mode)
  // If fullCodebase is provided, skip RAG and send entire repository to LLM
  if (options.fullCodebase) {
    return generateFullCodebaseAnswer(query, options.fullCodebase, provider, {
      dryRun: options.dryRun,
    });
  }

  // STEP 1: Secret redaction (CRITICAL - must happen before prompt building)
  // Research pattern: Redact sensitive patterns before external transmission
  // NEVER use original chunks after this point
  const redactedChunks = prepareChunksForAPI(chunks);

  // STEP 2: Cache lookup (before prompt building to save computation)
  // Generate cache key from query, chunks, and provider settings
  if (!options.noCache && provider) {
    const chunkIds = redactedChunks.map((c) => String(c.id));
    const cacheKey = generateCacheKey({
      query,
      chunkIds,
      provider: provider.name,
      model: provider.config?.model || 'default',
      maxTokens: (provider.config as { maxTokens?: number })?.maxTokens,
    });

    const cached = await responseCache.get(cacheKey);
    if (cached) {
      console.log(chalk.dim('💾 Using cached response\n'));
      console.log(cached.response);
      return;
    }
  }

  // STEP 3: Prompt construction (using redacted chunks)
  // XML-structured prompt with grounding instructions
  const prompt = buildRAGPrompt(query, redactedChunks);

  // STEP 4: Dry-run mode (show prompt without making API call)
  if (options.dryRun && provider) {
    console.log(chalk.yellow('⚠️  DRY-RUN MODE - No API call will be made\n'));
    console.log(chalk.bold('Prompt that would be sent:'));
    console.log('─'.repeat(80));
    console.log(prompt);
    console.log('─'.repeat(80));
    console.log(`\nProvider: ${provider.name}`);
    console.log(`Model: ${provider.config?.model || 'default'}`);
    console.log(`Chunks: ${redactedChunks.length}`);
    console.log(`Estimated tokens: ~${Math.floor(prompt.length / 4)}`);
    return;
  }

  // STEP 5: Graceful fallback if no provider (retrieval-only mode)
  if (!provider) {
    console.log(chalk.yellow('⚠️  No LLM provider configured. Showing retrieved code:'));
    console.log('Set API key environment variable or create .oraclerc file.');
    console.log('Run `oracle config` for setup help.\n');

    console.log(chalk.bold('📦 Retrieved chunks (top 5):'));
    console.log('─'.repeat(80));

    // Display first 5 chunks as fallback with rich UI
    const displayChunks = redactedChunks.slice(0, 5);
    for (let i = 0; i < displayChunks.length; i++) {
      const chunk = displayChunks[i];

      // Use renderCitation for clickable file links
      console.log(
        `\n${chalk.bold(`Chunk ${i + 1}:`)} ${renderCitation(chunk.filePath, chunk.startLine, process.cwd())}`,
      );

      if (chunk.symbolName) {
        console.log(`${chalk.bold('Symbol:')} ${chunk.symbolName}`);
      }

      // Use renderCodeBlock for syntax-highlighted content
      // Detect language from file extension for better highlighting
      const language = detectLanguage(chunk.filePath);
      const highlighted = renderCodeBlock(chunk.content, language);
      console.log(highlighted);
    }

    console.log('\n' + '─'.repeat(80));
    console.log(
      `\nFound ${chalk.bold(chunks.length)} total chunks. Configure API key to generate answers.`,
    );

    return;
  }

  // STEP 6: LLM streaming (with provider-specific dispatch)
  try {
    let response: string;

    // Dispatch to correct streaming function based on provider type
    if (provider.name === 'Anthropic') {
      const messages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];
      response = await streamAnthropicResponse(provider.client, messages, {
        model: provider.config?.model,
        maxTokens: provider.config?.maxTokens,
      });
    } else if (provider.name === 'OpenAI') {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];
      response = await streamOpenAIResponse(provider.client, messages, {
        model: provider.config?.model,
        maxTokens: provider.config?.maxTokens,
      });
    } else if (provider.name === 'Ollama') {
      const messages: OllamaMessage[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];
      const model = provider.config?.model ?? 'llama3.3';
      response = await streamOllamaResponse(provider.client, model, messages, {
        model: provider.config?.model,
      });
    } else {
      // Should never happen (TypeScript exhaustiveness check)
      throw new Error(`Unknown provider: ${(provider as Provider).name}`);
    }

    // STEP 7: Cache write (if enabled and successful)
    if (!options.noCache && response) {
      const chunkIds = redactedChunks.map((c) => String(c.id));
      const cacheKey = generateCacheKey({
        query,
        chunkIds,
        provider: provider.name,
        model: provider.config?.model || 'default',
        maxTokens: (provider.config as { maxTokens?: number })?.maxTokens,
      });

      await responseCache.set(cacheKey, {
        response,
        timestamp: Date.now(),
        provider: provider.name,
        model: provider.config?.model || 'default',
      });
    }

    // STEP 8: Citation extraction and validation
    const citations = extractCitations(response);
    const valid = validateCitations(citations, redactedChunks);

    // Warn user if citations are invalid (transparency about accuracy)
    if (!valid) {
      console.log(
        chalk.yellow('\n⚠️  Some citations may be inaccurate. Please verify the referenced code.'),
      );
    }

    // STEP 9: Display Sources section with clickable citations
    // Deduplicate file paths (same file cited multiple times should appear once)
    const uniqueFiles = new Map<string, { filePath: string; startLine: number }>();
    for (const chunk of redactedChunks) {
      if (!uniqueFiles.has(chunk.filePath)) {
        uniqueFiles.set(chunk.filePath, {
          filePath: chunk.filePath,
          startLine: chunk.startLine,
        });
      }
    }

    // Display sources with clickable links
    if (uniqueFiles.size > 0) {
      console.log('\n' + chalk.bold('📚 Sources:'));
      for (const { filePath, startLine } of uniqueFiles.values()) {
        console.log(renderCitation(filePath, startLine, process.cwd()));
      }
    }
  } catch (error) {
    // Error handling - user-friendly messages
    if (error instanceof Error) {
      console.error(chalk.red(`\n❌ Generation failed: ${error.message}`));

      // Suggest retry for transient errors
      if (error.message.includes('Rate limit') || error.message.includes('timeout')) {
        console.error('Try again in a few moments.');
      }

      // Suggest checking API key for auth errors
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        console.error('Check your API key configuration.');
      }

      // Suggest checking billing for credit balance errors
      if (error.message.includes('credit balance') || error.message.includes('billing')) {
        console.error('Visit https://console.anthropic.com/settings/billing to add credits.');
      }

      // Suggest starting Ollama for connection errors
      if (error.message.includes('Ollama not running')) {
        console.error('Make sure Ollama is running and try again.');
      }
    } else {
      console.error(chalk.red('\n❌ An unexpected error occurred during generation.'));
    }

    // Don't throw - we've already displayed error to user
    // Throwing would show stack trace which isn't helpful for users
  }
}

/**
 * Build prompt with full codebase context for small repositories.
 *
 * Instead of RAG chunks, sends entire repository to LLM.
 * Modern LLMs support 200K+ token context windows, making this feasible
 * for small codebases (<50K tokens).
 *
 * @param query - User's question
 * @param fullCodebase - Complete codebase text
 * @returns Prompt with full context
 */
function buildFullContextPrompt(query: string, fullCodebase: string): string {
  return `<instructions>
You are a code analysis assistant. The user has provided their ENTIRE codebase below.
Answer the question based on this code. Include file paths and line numbers when referencing specific code.
</instructions>

<codebase>
${fullCodebase}
</codebase>

<question>
${query}
</question>`;
}

/**
 * Generate answer using full codebase (bypassing RAG).
 *
 * For small repositories, sending the entire codebase provides better
 * accuracy than RAG approximation. This function handles the full-context
 * answer generation flow.
 *
 * @param query - User's question
 * @param fullCodebase - Complete codebase text
 * @param provider - LLM provider
 */
async function generateFullCodebaseAnswer(
  query: string,
  fullCodebase: string,
  provider: Provider | null,
  options: { dryRun?: boolean } = {},
): Promise<void> {
  // Build prompt with full codebase
  const prompt = buildFullContextPrompt(query, fullCodebase);

  // Dry-run mode: show prompt without making API call
  if (options.dryRun && provider) {
    console.log(chalk.yellow('⚠️  DRY-RUN MODE - No API call will be made\n'));
    console.log(chalk.bold('Prompt that would be sent:'));
    console.log('─'.repeat(80));
    console.log(prompt);
    console.log('─'.repeat(80));
    console.log(`\nProvider: ${provider.name}`);
    console.log(`Model: ${provider.config?.model || 'default'}`);
    console.log(`Mode: Full codebase (bypassing RAG)`);
    console.log(`Estimated tokens: ~${Math.floor(prompt.length / 4)}`);
    return;
  }

  // Graceful fallback if no provider
  if (!provider) {
    console.log(chalk.yellow('\n⚠️  No LLM provider configured.'));
    console.log('Set API key environment variable or create .oraclerc file.');
    console.log('Run `oracle config` for setup help.\n');
    return;
  }

  // Stream answer directly (no RAG, no reranking)
  try {
    if (provider.name === 'Anthropic') {
      const messages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];
      await streamAnthropicResponse(provider.client, messages, {
        model: provider.config?.model,
        maxTokens: provider.config?.maxTokens,
      });
    } else if (provider.name === 'OpenAI') {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];
      await streamOpenAIResponse(provider.client, messages, {
        model: provider.config?.model,
        maxTokens: provider.config?.maxTokens,
      });
    } else if (provider.name === 'Ollama') {
      const messages: OllamaMessage[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];
      const model = provider.config?.model ?? 'llama3.3';
      await streamOllamaResponse(provider.client, model, messages, {
        model: provider.config?.model,
      });
    } else {
      throw new Error(`Unknown provider: ${(provider as Provider).name}`);
    }
  } catch (error) {
    // Error handling - user-friendly messages
    if (error instanceof Error) {
      console.error(chalk.red(`\n❌ Generation failed: ${error.message}`));

      if (error.message.includes('Rate limit') || error.message.includes('timeout')) {
        console.error('Try again in a few moments.');
      }

      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        console.error('Check your API key configuration.');
      }

      if (error.message.includes('credit balance') || error.message.includes('billing')) {
        console.error('Visit https://console.anthropic.com/settings/billing to add credits.');
      }

      if (error.message.includes('Ollama not running')) {
        console.error('Make sure Ollama is running and try again.');
      }
    } else {
      console.error(chalk.red('\n❌ An unexpected error occurred during generation.'));
    }
  }
}
