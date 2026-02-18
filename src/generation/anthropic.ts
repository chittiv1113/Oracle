/**
 * Anthropic Claude API client initialization and streaming response handler.
 *
 * Provides:
 * - Client initialization with graceful degradation (no API key = null client)
 * - Token-by-token streaming to terminal using process.stdout.write()
 * - Rate limit error handling with retry-after display
 * - Configurable model, max_tokens, temperature, timeout
 *
 * Based on official SDK patterns from:
 * https://github.com/anthropics/anthropic-sdk-typescript/blob/main/examples/streaming.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import type { GenerationOptions } from './types.js';

/**
 * Initialize Anthropic client with optional API key.
 *
 * Configuration priority:
 * 1. Provided apiKey parameter
 * 2. process.env.ANTHROPIC_API_KEY
 *
 * Graceful degradation: Returns null if no API key available (no errors thrown).
 * This allows the tool to run in retrieval-only mode without LLM generation.
 *
 * @param apiKey - Optional API key. If not provided, uses ANTHROPIC_API_KEY env var
 * @returns Anthropic client instance or null if no API key available
 *
 * @example
 * ```typescript
 * const client = initAnthropicClient();
 * if (!client) {
 *   console.log('Running in retrieval-only mode');
 *   return;
 * }
 * // Use client for generation
 * ```
 */
export function initAnthropicClient(apiKey?: string): Anthropic | null {
  // Check for API key with priority: parameter > env var
  const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY;

  if (!resolvedApiKey) {
    // Graceful degradation - return null instead of throwing
    // Caller can check for null and provide user-friendly message
    return null;
  }

  // Initialize client with recommended settings from research
  return new Anthropic({
    apiKey: resolvedApiKey,
    maxRetries: 2, // SDK default - handles 429/408/5xx automatically
    timeout: 60000, // 60s for non-streaming (streaming has per-request timeout)
  });
}

/**
 * Stream LLM response token-by-token to terminal.
 *
 * Process:
 * 1. Create streaming request to Anthropic API
 * 2. Iterate over stream events using for-await
 * 3. Write text deltas to stdout using process.stdout.write() (NOT console.log)
 * 4. Add final newline after stream completes
 * 5. Return accumulated full response text
 *
 * CRITICAL: Uses process.stdout.write() to avoid newlines between tokens.
 * console.log() would break token-by-token streaming UX.
 *
 * Error handling:
 * - Rate limit (429): Display retry-after time from headers
 * - Timeout: 2-minute default (configurable via options.timeout)
 * - Network errors: Propagate with user-friendly messages
 *
 * @param client - Initialized Anthropic client from initAnthropicClient()
 * @param messages - Anthropic Messages API messages array
 * @param options - Optional generation configuration
 * @returns Promise resolving to full response text
 *
 * @example
 * ```typescript
 * const client = initAnthropicClient();
 * const messages = [{ role: 'user', content: 'Explain this code' }];
 * const response = await streamAnthropicResponse(client, messages, { maxTokens: 2048 });
 * ```
 */
export async function streamAnthropicResponse(
  client: Anthropic,
  messages: Anthropic.Messages.MessageParam[],
  options: GenerationOptions = {},
): Promise<string> {
  // Extract options with defaults from research
  const model = options.model ?? 'claude-sonnet-4-5-20250929';
  const maxTokens = options.maxTokens ?? 4096;
  const temperature = options.temperature; // SDK default is 1.0 if undefined
  const timeout = options.timeout ?? 120000; // 2 minutes for streaming (research recommendation)

  let fullResponse = '';

  try {
    // Create streaming request
    // Pattern from: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/examples/streaming.ts
    const stream = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        temperature,
        messages,
        stream: true,
      },
      {
        timeout, // Per-request timeout for long responses
      },
    );

    // Stream events to terminal token-by-token
    for await (const messageStreamEvent of stream) {
      // Check for text delta events (contains actual response tokens)
      if (
        messageStreamEvent.type === 'content_block_delta' &&
        messageStreamEvent.delta.type === 'text_delta'
      ) {
        const text = messageStreamEvent.delta.text;

        // CRITICAL: Use process.stdout.write() NOT console.log()
        // console.log adds newlines, breaking token-by-token streaming UX
        process.stdout.write(text);

        // Accumulate for return value
        fullResponse += text;
      }
    }

    // Add final newline after stream completes
    process.stdout.write('\n');

    return fullResponse;
  } catch (error) {
    // Error handling with user-friendly messages
    if (error instanceof Anthropic.APIError) {
      // Rate limit error (429) - show retry-after time
      if (error.status === 429) {
        const retryAfter = error.headers?.['retry-after'];
        const message = retryAfter
          ? `Rate limit exceeded. Retry after ${retryAfter} seconds.`
          : 'Rate limit exceeded. Please try again later.';

        throw new Error(message, { cause: error });
      }

      // Other API errors
      throw new Error(`Anthropic API error (${error.status}): ${error.message}`, { cause: error });
    }

    // Network/timeout errors
    if (error instanceof Error) {
      throw new Error(`Failed to stream response: ${error.message}`, { cause: error });
    }

    // Unknown errors
    throw error;
  }
}
