/**
 * Two-layer response caching system for LLM responses.
 *
 * Architecture:
 * - Layer 1: In-memory LRU cache (instant lookup, 100 entries max)
 * - Layer 2: Disk persistence (survives restarts, unlimited entries)
 *
 * Cache flow:
 * 1. Lookup: Check memory → Check disk → Return null
 * 2. Write: Write to both memory and disk
 * 3. Hit promotion: Disk hits promoted to memory
 * 4. Eviction: LRU evicts from memory only (disk persists)
 *
 * Design rationale:
 * - Memory cache provides instant response (<1ms)
 * - Disk cache provides persistence across sessions
 * - Two-layer approach balances speed and durability
 * - Lazy disk initialization avoids startup overhead
 */

import { LRUCache } from 'lru-cache';
import storage from 'node-persist';

/**
 * Cached response entry.
 */
export interface CacheEntry {
  /** LLM-generated response text */
  response: string;
  /** Unix timestamp when cached (milliseconds) */
  timestamp: number;
  /** Provider name that generated response */
  provider: string;
  /** Model that generated response */
  model: string;
}

/**
 * Two-layer response cache (memory + disk).
 *
 * Memory layer: LRU cache with size limits
 * - Max entries: 100
 * - Max size: 10MB
 * - Eviction: Least recently used
 *
 * Disk layer: Persistent storage
 * - Location: .oracle/cache/
 * - Format: JSON files via node-persist
 * - Lazy initialization: Only loads on first use
 *
 * @example
 * ```typescript
 * const cache = new ResponseCache('.oracle/cache');
 *
 * // Check cache
 * const cached = await cache.get(cacheKey);
 * if (cached) {
 *   console.log(cached.response);
 *   return;
 * }
 *
 * // Generate response...
 * const response = await generateAnswer(...);
 *
 * // Cache for future
 * await cache.set(cacheKey, {
 *   response,
 *   timestamp: Date.now(),
 *   provider: 'Anthropic',
 *   model: 'claude-sonnet-4-5-20250929',
 * });
 * ```
 */
export class ResponseCache {
  private memory: LRUCache<string, CacheEntry>;
  private diskInitialized = false;
  private cacheDir: string;

  /**
   * Create cache with specified disk directory.
   *
   * Memory cache is initialized immediately.
   * Disk cache initialization is deferred until first use.
   *
   * @param cacheDir - Directory for disk cache (default: .oracle/cache)
   */
  constructor(cacheDir: string = '.oracle/cache') {
    this.cacheDir = cacheDir;

    // Memory cache: 100 entries max, ~10MB size limit
    this.memory = new LRUCache<string, CacheEntry>({
      max: 100,
      maxSize: 10 * 1024 * 1024, // 10MB
      sizeCalculation: (entry) => JSON.stringify(entry).length,
    });
  }

  /**
   * Initialize disk storage (lazy, idempotent).
   *
   * Called automatically by get/set/clear methods.
   * Safe to call multiple times (checks diskInitialized flag).
   */
  private async ensureDiskInit(): Promise<void> {
    if (!this.diskInitialized) {
      await storage.init({ dir: this.cacheDir });
      this.diskInitialized = true;
    }
  }

  /**
   * Get cached entry by key.
   *
   * Lookup order:
   * 1. Memory cache (instant, <1ms)
   * 2. Disk cache (slower, ~5-10ms)
   * 3. Return null if not found
   *
   * Disk hits are promoted to memory cache for future speed.
   *
   * @param key - Cache key (SHA-256 hash from generateCacheKey)
   * @returns Cached entry if found, null otherwise
   *
   * @example
   * ```typescript
   * const cached = await cache.get(cacheKey);
   * if (cached) {
   *   console.log(`Cached ${Date.now() - cached.timestamp}ms ago`);
   *   return cached.response;
   * }
   * ```
   */
  async get(key: string): Promise<CacheEntry | null> {
    // Layer 1: Memory cache (instant)
    const memHit = this.memory.get(key);
    if (memHit) return memHit;

    // Layer 2: Disk cache (slower, but persistent)
    await this.ensureDiskInit();
    const diskHit = (await storage.getItem(key)) as CacheEntry | null;

    if (diskHit) {
      // Promote to memory cache for future speed
      this.memory.set(key, diskHit);
      return diskHit;
    }

    return null;
  }

  /**
   * Cache entry for future lookups.
   *
   * Writes to both layers atomically:
   * 1. Write to memory (instant)
   * 2. Write to disk (persistent)
   *
   * @param key - Cache key (SHA-256 hash)
   * @param entry - Response entry to cache
   *
   * @example
   * ```typescript
   * await cache.set(cacheKey, {
   *   response: 'The auth flow uses JWT tokens...',
   *   timestamp: Date.now(),
   *   provider: 'Anthropic',
   *   model: 'claude-sonnet-4-5-20250929',
   * });
   * ```
   */
  async set(key: string, entry: CacheEntry): Promise<void> {
    await this.ensureDiskInit();

    // Write to both layers
    this.memory.set(key, entry);
    await storage.setItem(key, entry);
  }

  /**
   * Clear all cached entries.
   *
   * Clears both memory and disk caches.
   * Used when index is updated (invalidate all cached responses).
   *
   * @example
   * ```typescript
   * // After updating index
   * await cache.clear();
   * console.log('Response cache cleared');
   * ```
   */
  async clear(): Promise<void> {
    await this.ensureDiskInit();
    this.memory.clear();
    await storage.clear();
  }
}
