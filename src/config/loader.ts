/**
 * Configuration loader with three-tier fallback.
 *
 * Priority order:
 * 1. Environment variables (highest priority)
 * 2. Config file (.oraclerc, oracle.config.js, package.json)
 * 3. Defaults (lowest priority)
 *
 * Pattern per Phase 4 research:
 * - Use Node 20+ native .env loading via process.loadEnvFile()
 * - Use cosmiconfig for config file discovery
 * - Gracefully degrade when config missing (no crashes)
 */

import { cosmiconfig } from 'cosmiconfig';
import type { OracleConfig } from './schema.js';

/**
 * Default configuration values.
 *
 * These are used when no env var or config file provides a value.
 */
const DEFAULTS: Required<OracleConfig> = {
  llm: {
    provider: 'anthropic',
  },
  anthropic: {
    apiKey: undefined,
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 4096,
  },
  openai: {
    apiKey: undefined,
    model: 'gpt-4o',
    maxTokens: 4096,
  },
  ollama: {
    host: 'http://127.0.0.1:11434',
    model: 'llama3.3',
  },
  cohere: {
    apiKey: undefined,
  },
};

/**
 * Loads Oracle configuration with three-tier fallback.
 *
 * Process:
 * 1. Load .env file (if exists) using Node 20+ native support
 * 2. Search for config file using cosmiconfig
 * 3. Merge: env vars > config file > defaults
 *
 * Config file search order (via cosmiconfig):
 * - package.json "oracle" property
 * - .oraclerc (JSON or YAML)
 * - .oraclerc.json, .oraclerc.yaml, .oraclerc.yml
 * - .oraclerc.js, .oraclerc.cjs, .oraclerc.mjs (exports config object)
 * - oracle.config.js, oracle.config.cjs, oracle.config.mjs
 * - .config/oraclerc (and variants above)
 *
 * Edge cases:
 * - No .env file: Continue (not required)
 * - No config file: Use defaults + env vars
 * - Invalid config file: Log warning, use defaults + env vars
 * - Missing API keys: Return undefined (graceful degradation)
 *
 * @returns Promise resolving to merged configuration
 *
 * @example
 * ```typescript
 * const config = await loadConfig();
 * if (!config.anthropic?.apiKey) {
 *   console.warn('No Anthropic API key configured');
 *   // Fall back to retrieval-only mode
 * }
 * ```
 */
export async function loadConfig(): Promise<OracleConfig> {
  // Tier 1: Load .env file (Node 20+ native support)
  // This sets process.env.* variables from .env file in CWD
  try {
    // process.loadEnvFile() is available in Node 20.6.0+
    // If .env doesn't exist, this throws - catch and continue
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile();
    }
  } catch {
    // .env file doesn't exist or can't be loaded - that's OK
    // User may be using system env vars or config file
  }

  // Tier 2: Load config file via cosmiconfig
  let fileConfig: OracleConfig | undefined;
  try {
    const explorer = cosmiconfig('oracle');
    const result = await explorer.search();

    if (result && !result.isEmpty) {
      fileConfig = result.config as OracleConfig;
    }
  } catch (error) {
    // Config file exists but is invalid (parse error, syntax error)
    // Log warning but continue with defaults
    console.warn('Failed to load config file:', error instanceof Error ? error.message : error);
  }

  // Tier 3: Merge with priority (env var > config file > defaults)
  return {
    llm: {
      // Provider: config file overrides default
      provider: fileConfig?.llm?.provider || DEFAULTS.llm.provider,
    },
    anthropic: {
      // API key: env var takes precedence over config file
      apiKey: process.env.ANTHROPIC_API_KEY || fileConfig?.anthropic?.apiKey,

      // Model: config file overrides default (env var not typically used for model)
      model: fileConfig?.anthropic?.model || DEFAULTS.anthropic.model,

      // Max tokens: config file overrides default
      maxTokens: fileConfig?.anthropic?.maxTokens || DEFAULTS.anthropic.maxTokens,
    },
    openai: {
      // API key: env var takes precedence over config file
      apiKey: process.env.OPENAI_API_KEY || fileConfig?.openai?.apiKey,

      // Model: config file overrides default
      model: fileConfig?.openai?.model || DEFAULTS.openai.model,

      // Max tokens: config file overrides default
      maxTokens: fileConfig?.openai?.maxTokens || DEFAULTS.openai.maxTokens,
    },
    ollama: {
      // Host: env var takes precedence over config file
      host: process.env.OLLAMA_HOST || fileConfig?.ollama?.host || DEFAULTS.ollama.host,

      // Model: config file overrides default
      model: fileConfig?.ollama?.model || DEFAULTS.ollama.model,
    },
    cohere: {
      // API key: env var takes precedence over config file
      apiKey: process.env.COHERE_API_KEY || fileConfig?.cohere?.apiKey,
    },
  };
}
