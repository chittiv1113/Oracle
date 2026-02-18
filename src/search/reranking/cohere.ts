import { CohereClient } from 'cohere-ai';

export interface CohereReranker {
  client: CohereClient;
}

export function initCohereReranker(apiKey: string): CohereReranker {
  const client = new CohereClient({ token: apiKey });
  return { client };
}

export interface RerankCandidate {
  id: number;
  content: string;
}

export interface RerankResult {
  id: number;
  score: number;
}

export async function rerankWithCohere(
  reranker: CohereReranker,
  query: string,
  candidates: RerankCandidate[],
  topN: number = 12,
): Promise<RerankResult[]> {
  const contentArray = candidates.map((c) => c.content);

  const response = await reranker.client.rerank({
    model: 'rerank-v3.5',
    query: query,
    documents: contentArray,
    topN: topN,
    returnDocuments: false,
  });

  return response.results.map((r) => ({
    id: candidates[r.index].id,
    score: r.relevanceScore,
  }));
}
