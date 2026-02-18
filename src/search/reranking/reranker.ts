import {
  initCohereReranker,
  rerankWithCohere,
  type CohereReranker,
  type RerankCandidate,
  type RerankResult,
} from './cohere.js';
import { initONNXReranker, rerankWithONNX, type ONNXReranker } from './onnx.js';

export type { RerankCandidate, RerankResult };

export interface Reranker {
  mode: 'cohere' | 'onnx' | 'none';
  cohere?: CohereReranker;
  onnx?: ONNXReranker;
}

/**
 * Initialize reranker with automatic fallback.
 * Tries Cohere first (if API key available), falls back to ONNX.
 */
export async function initReranker(cohereApiKey?: string): Promise<Reranker> {
  const apiKey = cohereApiKey || process.env.COHERE_API_KEY;

  if (apiKey) {
    try {
      const cohere = initCohereReranker(apiKey);
      return { mode: 'cohere', cohere };
    } catch (error) {
      console.warn('Failed to initialize Cohere, falling back to ONNX:', error);
      const onnx = await initONNXReranker();
      return { mode: 'onnx', onnx };
    }
  } else {
    const onnx = await initONNXReranker();
    return { mode: 'onnx', onnx };
  }
}

/**
 * Rerank candidates using best available method.
 * Tries Cohere first, falls back to ONNX on error, ultimate fallback returns first topN.
 */
export async function rerank(
  reranker: Reranker,
  query: string,
  candidates: RerankCandidate[],
  topN: number = 12,
): Promise<RerankResult[]> {
  // Empty candidates check
  if (candidates.length === 0) {
    return [];
  }

  // If candidates <= topN, skip reranking
  if (candidates.length <= topN) {
    return candidates.map((c) => ({ id: c.id, score: 1.0 }));
  }

  // Try Cohere first
  if (reranker.mode === 'cohere' && reranker.cohere) {
    try {
      return await rerankWithCohere(reranker.cohere, query, candidates, topN);
    } catch (error) {
      console.warn('Cohere rerank failed, falling back to ONNX:', error);
      // Fall through to ONNX
    }
  }

  // Fallback to ONNX
  if (reranker.onnx) {
    return await rerankWithONNX(reranker.onnx, query, candidates, topN);
  }

  // Ultimate fallback: return first topN candidates as-is
  console.warn('No reranker available, returning top candidates without reranking');
  return candidates.slice(0, topN).map((c) => ({ id: c.id, score: 1.0 }));
}
