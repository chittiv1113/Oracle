/**
 * Shared types for LLM generation functionality.
 *
 * Used across Anthropic client, prompt building, and response handling.
 */

/**
 * Configuration options for LLM generation.
 */
export interface GenerationOptions {
  /**
   * Model identifier to use for generation.
   * Default: 'claude-sonnet-4-5-20250929'
   *
   * Common models:
   * - claude-sonnet-4-5-20250929 (default - best balance of speed/quality)
   * - claude-opus-4-6 (highest quality, 1M context window)
   * - claude-haiku-4-5 (fastest, most economical)
   */
  model?: string;

  /**
   * Maximum number of tokens to generate.
   * Default: 4096
   *
   * Higher values allow longer responses but increase cost and latency.
   */
  maxTokens?: number;

  /**
   * Sampling temperature (0.0 to 1.0).
   * Default: 1.0 (SDK default)
   *
   * Lower values (0.0-0.3) for deterministic/factual responses.
   * Higher values (0.7-1.0) for creative/varied responses.
   */
  temperature?: number;

  /**
   * Request timeout in milliseconds.
   * Default: 120000 (2 minutes)
   *
   * Streaming requests may take longer for complex queries.
   */
  timeout?: number;
}

/**
 * Stream event types emitted during response generation.
 *
 * Based on Anthropic SDK MessageStreamEvent types.
 */
export type StreamEvent =
  | { type: 'message_start'; message: unknown }
  | { type: 'content_block_start'; index: number; content_block: unknown }
  | { type: 'content_block_delta'; index: number; delta: TextDelta | unknown }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: unknown; usage: unknown }
  | { type: 'message_stop' };

/**
 * Text delta event containing incremental response tokens.
 */
export interface TextDelta {
  type: 'text_delta';
  text: string;
}

/**
 * Unified LLM provider interface.
 *
 * Represents an initialized LLM provider (Anthropic, OpenAI, or Ollama)
 * with its configuration and client instance.
 *
 * Used by provider factory to abstract over different LLM backends.
 */
export interface LLMProvider {
  /** Provider name for logging and dispatch */
  name: 'Anthropic' | 'OpenAI' | 'Ollama';

  /** Initialized client instance (type varies by provider) */
  client: unknown;

  /** Provider configuration */
  config: unknown;
}
