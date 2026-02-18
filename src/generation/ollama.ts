/**
 * Ollama client initialization and streaming response handler.
 *
 * Provides:
 * - Client initialization with lazy detection (no upfront health checks)
 * - Token-by-token streaming to terminal using process.stdout.write()
 * - User-friendly error messages for connection issues
 * - Configurable host via OLLAMA_HOST env var or config
 *
 * CRITICAL: Lazy detection pattern - only check if Ollama running when actually using it.
 * No upfront health checks that could slow down startup or cause false negatives.
 */

import { Ollama } from 'ollama';
import type { Message } from 'ollama';
import type { GenerationOptions } from './types.js';
import type { OllamaConfig } from '../config/schema.js';

/**
 * Initialize Ollama client with optional configuration.
 *
 * Configuration priority:
 * 1. config.host parameter
 * 2. process.env.OLLAMA_HOST
 * 3. Default: http://127.0.0.1:11434
 *
 * IMPORTANT: Uses lazy detection - does NOT check if Ollama is running during init.
 * Server availability is checked on first API call, providing clearer error context.
 * This avoids false negatives from health checks and speeds up initialization.
 *
 * @param config - Optional Ollama configuration
 * @returns Ollama client instance
 *
 * @example
 * ```typescript
 * const client = initOllamaClient();
 * // Client is created immediately - no server check yet
 *
 * try {
 *   const response = await streamOllamaResponse(client, 'llama3.3', messages);
 *   // Server is checked here on first actual use
 * } catch (error) {
 *   if (error.message.includes('not running')) {
 *     console.error('Start Ollama server and try again');
 *   }
 * }
 * ```
 */
export function initOllamaClient(config?: OllamaConfig): Ollama {
  // Resolve host with priority: config > env var > default
  const host = config?.host || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

  // Create client - no health check performed
  // Lazy detection: server availability checked on first API call
  return new Ollama({ host });
}

/**
 * Stream LLM response token-by-token to terminal.
 *
 * Process:
 * 1. Create streaming chat request to Ollama API
 * 2. Iterate over stream using for-await
 * 3. Write message content deltas to stdout using process.stdout.write()
 * 4. Add final newline after stream completes
 * 5. Return accumulated full response text
 *
 * CRITICAL: Uses process.stdout.write() to avoid newlines between tokens.
 * console.log() would break token-by-token streaming UX.
 *
 * Error handling:
 * - ECONNREFUSED: Translate to user-friendly "Ollama not running" message
 * - Network errors: Propagate with clear context
 * - Model errors: Pass through Ollama's error messages
 *
 * @param client - Initialized Ollama client from initOllamaClient()
 * @param model - Model name (e.g., 'llama3.3', 'qwen2.5-coder')
 * @param messages - Chat messages array (same format as Anthropic)
 * @param options - Optional generation configuration
 * @returns Promise resolving to full response text
 *
 * @example
 * ```typescript
 * const client = initOllamaClient();
 * const messages = [{ role: 'user', content: 'Explain this code' }];
 * const response = await streamOllamaResponse(client, 'llama3.3', messages);
 * ```
 */
export async function streamOllamaResponse(
  client: Ollama,
  model: string,
  messages: Message[],
  options: GenerationOptions = {},
): Promise<string> {
  // Extract options with defaults
  const resolvedModel = options.model ?? model ?? 'llama3.3';

  let fullResponse = '';

  try {
    // Create streaming chat request
    // Ollama SDK pattern: https://github.com/ollama/ollama-js
    const stream = await client.chat({
      model: resolvedModel,
      messages,
      stream: true,
    });

    // Stream messages to terminal token-by-token
    for await (const chunk of stream) {
      // Extract text content from message
      const text = chunk.message?.content ?? '';

      if (text) {
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

    // Connection refused - Ollama not running
    if (error instanceof Error) {
      // Check for ECONNREFUSED in error code or message
      const isConnectionRefused =
        ('code' in error && error.code === 'ECONNREFUSED') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('connect');

      if (isConnectionRefused) {
        throw new Error('Ollama not running at localhost:11434. Start Ollama and try again.', {
          cause: error,
        });
      }

      // Other errors - pass through with context
      throw new Error(`Failed to stream Ollama response: ${error.message}`, { cause: error });
    }

    // Unknown errors
    throw error;
  }
}
