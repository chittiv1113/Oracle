/**
 * LLM provider factory for multi-provider support.
 *
 * Provides unified initialization logic for Anthropic, OpenAI, and Ollama providers.
 * Follows the same factory pattern as reranker.ts for consistency.
 *
 * Design pattern:
 * - Config-driven provider selection (config.llm.provider)
 * - Graceful degradation when provider unavailable
 * - Lazy initialization (create client only when selected)
 * - Type-safe dispatch using discriminated union
 */

import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import type { Ollama } from 'ollama';
import { initAnthropicClient } from './anthropic.js';
import { initOpenAIClient } from './openai.js';
import { initOllamaClient } from './ollama.js';
import type { OracleConfig } from '../config/schema.js';

/**
 * Anthropic provider type.
 */
export interface AnthropicProvider {
  name: 'Anthropic';
  client: Anthropic;
  config: OracleConfig['anthropic'];
}

/**
 * OpenAI provider type.
 */
export interface OpenAIProvider {
  name: 'OpenAI';
  client: OpenAI;
  config: OracleConfig['openai'];
}

/**
 * Ollama provider type.
 */
export interface OllamaProvider {
  name: 'Ollama';
  client: Ollama;
  config: OracleConfig['ollama'];
}

/**
 * Union type for all provider types.
 * Enables type-safe dispatch based on provider.name.
 */
export type Provider = AnthropicProvider | OpenAIProvider | OllamaProvider;

/**
 * Initialize LLM provider based on configuration.
 *
 * Process:
 * 1. Read active provider from config.llm.provider (default: 'anthropic')
 * 2. Initialize corresponding client (Anthropic, OpenAI, or Ollama)
 * 3. Return provider object with name, client, and config
 * 4. Return null if provider unavailable (graceful degradation)
 *
 * Provider selection priority:
 * - config.llm.provider setting (user's explicit choice)
 * - Falls back to 'anthropic' if not specified
 *
 * Graceful degradation:
 * - Anthropic/OpenAI: Returns null if no API key configured
 * - Ollama: Always returns client (server check happens on first use)
 *
 * @param config - Oracle configuration with provider settings
 * @returns Initialized provider object or null if unavailable
 *
 * @example
 * ```typescript
 * const config = await loadConfig();
 * const provider = await initLLMProvider(config);
 *
 * if (!provider) {
 *   console.log('No LLM provider available');
 *   return;
 * }
 *
 * // Dispatch based on provider type
 * if (provider.name === 'Anthropic') {
 *   const response = await streamAnthropicResponse(provider.client, messages);
 * } else if (provider.name === 'OpenAI') {
 *   const response = await streamOpenAIResponse(provider.client, messages);
 * } else if (provider.name === 'Ollama') {
 *   const response = await streamOllamaResponse(provider.client, model, messages);
 * }
 * ```
 */
export function initLLMProvider(config: OracleConfig): Provider | null {
  // Read active provider from config (default: 'anthropic')
  const activeProvider = config.llm?.provider ?? 'anthropic';

  // Initialize corresponding provider
  switch (activeProvider) {
    case 'anthropic': {
      const client = initAnthropicClient(config.anthropic?.apiKey);
      if (!client) {
        // No API key - graceful degradation
        return null;
      }
      return {
        name: 'Anthropic',
        client,
        config: config.anthropic,
      };
    }

    case 'openai': {
      const client = initOpenAIClient(config.openai?.apiKey);
      if (!client) {
        // No API key - graceful degradation
        return null;
      }
      return {
        name: 'OpenAI',
        client,
        config: config.openai,
      };
    }

    case 'ollama': {
      const client = initOllamaClient(config.ollama);
      // Ollama always returns client (lazy detection on first use)
      return {
        name: 'Ollama',
        client,
        config: config.ollama,
      };
    }

    default: {
      // Unknown provider - throw error (configuration bug)
      throw new Error(
        `Unknown LLM provider: ${activeProvider}. Valid options: anthropic, openai, ollama`,
      );
    }
  }
}
