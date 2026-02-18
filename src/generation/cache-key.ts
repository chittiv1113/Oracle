/**
 * Cache key generation for response caching.
 *
 * Generates deterministic SHA-256 hashes from query parameters to enable
 * consistent cache lookups across sessions.
 *
 * Key components:
 * - Query text (normalized to lowercase)
 * - Chunk IDs (sorted for order-independence)
 * - Provider name and model
 * - Max tokens setting
 *
 * Design: Uses fast-json-stable-stringify for deterministic JSON serialization
 * (26% faster than alternatives) and SHA-256 for collision-resistant hashing.
 */

import { createHash } from 'node:crypto';
import stringify from 'fast-json-stable-stringify';

/**
 * Input parameters for cache key generation.
 */
export interface CacheKeyInput {
  /** User's question about the codebase */
  query: string;
  /** Array of chunk IDs from search results */
  chunkIds: string[];
  /** LLM provider name (e.g., 'Anthropic', 'OpenAI', 'Ollama') */
  provider: string;
  /** Model identifier (e.g., 'claude-sonnet-4-5-20250929') */
  model: string;
  /** Maximum tokens for response (affects output) */
  maxTokens?: number;
}

/**
 * Generate deterministic cache key from query parameters.
 *
 * Process:
 * 1. Normalize inputs (lowercase query, sort chunk IDs)
 * 2. Serialize to stable JSON (consistent key order)
 * 3. Hash with SHA-256 (compact, collision-resistant)
 *
 * Cache key properties:
 * - Deterministic: Same inputs always produce same key
 * - Order-independent: Chunk order doesn't affect key
 * - Collision-resistant: SHA-256 ensures unique keys
 * - Compact: 64 hex characters (32 bytes)
 *
 * @param input - Query parameters to hash
 * @returns 64-character hex string (SHA-256 hash)
 *
 * @example
 * ```typescript
 * const key = generateCacheKey({
 *   query: 'How does auth work?',
 *   chunkIds: ['file.ts:1-10', 'file.ts:20-30'],
 *   provider: 'Anthropic',
 *   model: 'claude-sonnet-4-5-20250929',
 *   maxTokens: 4096,
 * });
 * // Returns: 'a1b2c3d4...' (64 hex characters)
 * ```
 */
export function generateCacheKey(input: CacheKeyInput): string {
  // Normalize inputs for consistent hashing
  const normalized = {
    query: input.query.trim().toLowerCase(),
    chunkIds: [...input.chunkIds].sort(), // Order-independent
    provider: input.provider,
    model: input.model,
    maxTokens: input.maxTokens || 4096,
  };

  // Use stable stringify to ensure consistent key order
  // fast-json-stable-stringify is 26% faster than alternatives
  const json = stringify(normalized);

  // SHA-256 hash for compact, collision-resistant key
  return createHash('sha256').update(json, 'utf8').digest('hex');
}
