import { describe, it, expect, beforeAll } from 'vitest';
import { initONNXReranker, rerankWithONNX } from '../../../src/search/reranking/onnx.js';
import type { RerankCandidate } from '../../../src/search/reranking/cohere.js';
import { existsSync, readdirSync } from 'node:fs';

describe('ONNX Reranker', () => {
  // Check if model is available (may be downloaded on first run)
  const modelDir = '.oracle/models';
  let modelExists = false;

  beforeAll(() => {
    // Check if any ONNX model exists in the directory
    try {
      if (existsSync(modelDir)) {
        const files = readdirSync(modelDir, { recursive: true });
        modelExists = files.some((file: string) => file.toString().endsWith('.onnx'));
      }
    } catch (error) {
      console.warn('Could not check for ONNX model:', error);
    }
  });

  describe('initONNXReranker', () => {
    it('should initialize reranker with model download on first use', async () => {
      const reranker = await initONNXReranker();

      // Should return an object with session and tokenizer
      expect(reranker).toBeDefined();
      expect(reranker).toHaveProperty('session');
      expect(reranker).toHaveProperty('tokenizer');

      // Session may be null if download fails (graceful degradation)
      if (reranker.session) {
        expect(reranker.tokenizer).toBeDefined();
      }
    }, 120000); // 2 minute timeout for model download

    it('should use cached model on subsequent runs', async () => {
      // Second initialization should be fast (no download)
      const startTime = Date.now();
      const reranker = await initONNXReranker();
      const duration = Date.now() - startTime;

      expect(reranker).toBeDefined();

      // If model exists, initialization should be fast (<10s)
      if (modelExists) {
        expect(duration).toBeLessThan(10000);
      }
    }, 15000);
  });

  describe('rerankWithONNX', () => {
    const mockCandidates: RerankCandidate[] = [
      {
        id: 1,
        content:
          'authenticate() function validates user credentials using bcrypt password hashing and JWT token generation',
      },
      {
        id: 2,
        content: 'login() calls authenticate() with username and password from request body',
      },
      { id: 3, content: 'logout() clears user session and removes authentication token' },
      { id: 4, content: 'renderButton() displays UI component with React hooks' },
      {
        id: 5,
        content: 'calculateTax() computes sales tax based on location and price',
      },
    ];

    it('should gracefully fallback when session is null', async () => {
      const reranker = { session: null, tokenizer: null };
      const results = await rerankWithONNX(reranker, 'authentication', mockCandidates, 3);

      expect(results).toHaveLength(3);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('score');
      expect(results[0].score).toBe(1.0); // Fallback score
    });

    it.skipIf(!modelExists)(
      'should rerank candidates by relevance',
      async () => {
        const reranker = await initONNXReranker();

        if (!reranker.session) {
          console.log('Skipping test: ONNX model not available');
          return;
        }

        const query = 'How does authentication work?';
        const results = await rerankWithONNX(reranker, query, mockCandidates, 3);

        // Should return top 3 results
        expect(results).toHaveLength(3);

        // Each result should have id and score
        results.forEach((result) => {
          expect(result).toHaveProperty('id');
          expect(result).toHaveProperty('score');
          expect(typeof result.score).toBe('number');
        });

        // Top result should have higher score than last result
        expect(results[0].score).toBeGreaterThan(results[results.length - 1].score);

        // Relevant chunks (authenticate, login) should rank higher than irrelevant (calculateTax)
        const topIds = results.map((r) => r.id);
        const taxRank = topIds.indexOf(5); // calculateTax is id 5

        // Tax calculation should NOT be in top 3 for authentication query
        expect(taxRank).toBe(-1);
      },
      30000,
    ); // 30s timeout for inference

    it('should handle empty candidates array', async () => {
      const reranker = await initONNXReranker();
      const results = await rerankWithONNX(reranker, 'test query', [], 10);

      expect(results).toEqual([]);
    });

    it('should skip reranking when candidates <= topN', async () => {
      const reranker = await initONNXReranker();
      const smallCandidates = mockCandidates.slice(0, 2);
      const results = await rerankWithONNX(reranker, 'test query', smallCandidates, 5);

      // Should return all candidates without actual reranking
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it.skipIf(!modelExists)(
      'should handle long candidate content with truncation',
      async () => {
        const reranker = await initONNXReranker();

        if (!reranker.session) {
          console.log('Skipping test: ONNX model not available');
          return;
        }

        const longContent = 'a'.repeat(10000); // Very long content
        const candidates: RerankCandidate[] = [
          { id: 1, content: longContent },
          { id: 2, content: 'authenticate user credentials' },
        ];

        const results = await rerankWithONNX(reranker, 'authentication', candidates, 2);

        // Should handle truncation without errors
        expect(results).toHaveLength(2);
        expect(results[0]).toHaveProperty('score');
      },
      30000,
    );

    it.skipIf(!modelExists)(
      'should verify quality improvement over random ordering',
      async () => {
        const reranker = await initONNXReranker();

        if (!reranker.session) {
          console.log('Skipping test: ONNX model not available');
          return;
        }

        const query = 'user authentication and login';
        const results = await rerankWithONNX(reranker, query, mockCandidates, 5);

        // Top results should be authentication-related (ids 1, 2, 3)
        const topIds = results.slice(0, 3).map((r) => r.id);

        // At least 2 of the top 3 should be auth-related
        const authRelatedCount = topIds.filter((id) => id <= 3).length;
        expect(authRelatedCount).toBeGreaterThanOrEqual(2);

        // Scores should be different (not all 1.0)
        const uniqueScores = new Set(results.map((r) => r.score));
        expect(uniqueScores.size).toBeGreaterThan(1);
      },
      30000,
    );
  });
});
