/**
 * OpenAI API client initialization and streaming response handler.
 *
 * Provides:
 * - Client initialization with graceful degradation (no API key = null client)
 * - Token-by-token streaming to terminal using process.stdout.write()
 * - Auto-detection of o1 models for non-streaming responses
 * - Rate limit error handling with retry-after display
 * - Configurable model, max_tokens, temperature, timeout
 *
 * Supports all current OpenAI models:
 * - GPT-4o, GPT-4o-mini (streaming)
 * - o1, o1-mini, o1-preview (non-streaming)
 */

import OpenAI from 'openai';
import type { GenerationOptions } from './types.js';

/**
 * Initialize OpenAI client with optional API key.
 *
 * Configuration priority:
 * 1. Provided apiKey parameter
 * 2. process.env.OPENAI_API_KEY
 *
 * Graceful degradation: Returns null if no API key available (no errors thrown).
 * This allows the tool to run in retrieval-only mode without LLM generation.
 *
 * @param apiKey - Optional API key. If not provided, uses OPENAI_API_KEY env var
 * @returns OpenAI client instance or null if no API key available
 *
 * @example
 * ```typescript
 * const client = initOpenAIClient();
 * if (!client) {
 *   console.log('Running in retrieval-only mode');
 *   return;
 * }
 * // Use client for generation
 * ```
 */
export function initOpenAIClient(apiKey?: string): OpenAI | null {
  // Check for API key with priority: parameter > env var
  const resolvedApiKey = apiKey || process.env.OPENAI_API_KEY;

  if (!resolvedApiKey) {
    // Graceful degradation - return null instead of throwing
    // Caller can check for null and provide user-friendly message
    return null;
  }

  // Initialize client with recommended settings matching Anthropic pattern
  return new OpenAI({
    apiKey: resolvedApiKey,
    maxRetries: 2, // SDK default - handles 429/408/5xx automatically
    timeout: 60000, // 60s for non-streaming (streaming has per-request timeout)
  });
}

/**
 * Check if a model supports streaming based on its name.
 *
 * OpenAI o1 reasoning models (o1, o1-mini, o1-preview, o1-2024-12-17)
 * do not support streaming. All other models (GPT-4o, GPT-4o-mini, etc.) do.
 *
 * @param model - OpenAI model name
 * @returns true if model supports streaming, false otherwise
 *
 * @example
 * ```typescript
 * supportsStreaming('gpt-4o'); // true
 * supportsStreaming('gpt-4o-mini'); // true
 * supportsStreaming('o1-preview'); // false
 * supportsStreaming('o1-2024-12-17'); // false
 * ```
 */
export function supportsStreaming(model: string): boolean {
  // o1 models don't support streaming
  return !model.startsWith('o1');
}

/**
 * Stream LLM response token-by-token to terminal (or wait for full response for o1 models).
 *
 * Process:
 * 1. Auto-detect streaming capability based on model name
 * 2. For streaming models (GPT-4o, etc.):
 *    - Create streaming request to OpenAI API
 *    - Iterate over stream events using for-await
 *    - Write text deltas to stdout using process.stdout.write() (NOT console.log)
 * 3. For o1 models:
 *    - Create non-streaming request
 *    - Wait for full response
 *    - Write complete response to stdout
 * 4. Add final newline after response completes
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
 * @param client - Initialized OpenAI client from initOpenAIClient()
 * @param messages - OpenAI chat messages array
 * @param options - Optional generation configuration
 * @returns Promise resolving to full response text
 *
 * @example
 * ```typescript
 * const client = initOpenAIClient();
 * const messages = [{ role: 'user', content: 'Explain this code' }];
 * const response = await streamOpenAIResponse(client, messages, { maxTokens: 2048 });
 * ```
 */
export async function streamOpenAIResponse(
  client: OpenAI,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  options: GenerationOptions = {},
): Promise<string> {
  // Extract options with defaults from research
  const model = options.model ?? 'gpt-4o';
  const maxTokens = options.maxTokens ?? 4096;
  const temperature = options.temperature; // SDK default is 1.0 if undefined
  const timeout = options.timeout ?? 120000; // 2 minutes for long responses

  let fullResponse = '';

  try {
    // Auto-detect streaming capability based on model
    const useStreaming = supportsStreaming(model);

    if (useStreaming) {
      // Streaming path for GPT-4o, GPT-4o-mini, etc.
      const stream = await client.chat.completions.create(
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
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          // CRITICAL: Use process.stdout.write() NOT console.log()
          // console.log adds newlines, breaking token-by-token streaming UX
          process.stdout.write(delta);

          // Accumulate for return value
          fullResponse += delta;
        }
      }
    } else {
      // Non-streaming path for o1 models
      const response = await client.chat.completions.create(
        {
          model,
          max_tokens: maxTokens,
          temperature,
          messages,
          stream: false,
        },
        {
          timeout, // Per-request timeout for long responses
        },
      );

      // Extract full response
      const content = response.choices[0]?.message?.content ?? '';

      // Write full response to stdout
      process.stdout.write(content);

      fullResponse = content;
    }

    // Add final newline after response completes
    process.stdout.write('\n');

    return fullResponse;
  } catch (error) {
    // Error handling with user-friendly messages
    if (error instanceof OpenAI.APIError) {
      // Rate limit error (429) - show retry-after time
      if (error.status === 429) {
        const retryAfter = error.headers?.['retry-after'];
        const message = retryAfter
          ? `Rate limit exceeded. Retry after ${retryAfter} seconds.`
          : 'Rate limit exceeded. Please try again later.';

        throw new Error(message, { cause: error });
      }

      // Other API errors
      throw new Error(`OpenAI API error (${error.status}): ${error.message}`, { cause: error });
    }

    // Network/timeout errors
    if (error instanceof Error) {
      throw new Error(`Failed to stream response: ${error.message}`, { cause: error });
    }

    // Unknown errors
    throw error;
  }
}
