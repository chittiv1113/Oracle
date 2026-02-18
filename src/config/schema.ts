/**
 * Configuration schema and types for Oracle.
 *
 * Defines TypeScript interfaces for configuration file structure.
 * Used by loader.ts for type-safe config loading and validation.
 */

/**
 * Anthropic Claude configuration.
 */
export interface AnthropicConfig {
  /** Anthropic API key (env var: ANTHROPIC_API_KEY) */
  apiKey?: string;

  /** Model name to use (default: claude-sonnet-4-5-20250929) */
  model?: string;

  /** Maximum tokens to generate (default: 4096) */
  maxTokens?: number;
}

/**
 * OpenAI configuration.
 */
export interface OpenAIConfig {
  /** OpenAI API key (env var: OPENAI_API_KEY) */
  apiKey?: string;

  /** Model name to use (default: gpt-4o) */
  model?: string;

  /** Maximum tokens to generate (default: 4096) */
  maxTokens?: number;
}

/**
 * Ollama configuration.
 */
export interface OllamaConfig {
  /** Ollama host URL (env var: OLLAMA_HOST, default: http://127.0.0.1:11434) */
  host?: string;

  /** Model name to use (e.g., 'llama3.3', 'qwen2.5-coder') */
  model?: string;
}

/**
 * Cohere configuration.
 */
export interface CohereConfig {
  /** Cohere API key (env var: COHERE_API_KEY) */
  apiKey?: string;
}

/**
 * LLM provider configuration.
 */
export interface LLMConfig {
  /** Active LLM provider (default: 'anthropic') */
  provider?: 'anthropic' | 'openai' | 'ollama';
}

/**
 * Oracle configuration structure.
 *
 * Can be defined in:
 * - .oraclerc (JSON or YAML)
 * - .oraclerc.json
 * - .oraclerc.yaml
 * - .oraclerc.js (exports object)
 * - oracle.config.js
 * - package.json "oracle" property
 *
 * Environment variables take precedence over config file values.
 */
export interface OracleConfig {
  /** LLM provider selection */
  llm?: LLMConfig;

  /** Anthropic Claude configuration */
  anthropic?: AnthropicConfig;

  /** OpenAI configuration */
  openai?: OpenAIConfig;

  /** Ollama configuration */
  ollama?: OllamaConfig;

  /** Cohere reranking configuration */
  cohere?: CohereConfig;
}
