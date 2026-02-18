import { createHash } from 'node:crypto';

/**
 * Computes SHA-256 hash of content for incremental indexing.
 *
 * @param content - String content to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}
