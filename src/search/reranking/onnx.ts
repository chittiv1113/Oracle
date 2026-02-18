// Lazy import onnxruntime-node to avoid loading it at CLI startup
// This prevents the "API version [24] not available" warning unless ONNX is actually used
import type * as ort from 'onnxruntime-node';
import { AutoTokenizer } from '@huggingface/transformers';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RerankCandidate, RerankResult } from './cohere.js';

export interface ONNXReranker {
  session: ort.InferenceSession | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokenizer: any; // Transformers.js AutoTokenizer - complex type, no official typings
}

/**
 * Initialize ONNX cross-encoder reranker.
 *
 * Downloads ms-marco-MiniLM-L6-v2 model on first use (one-time setup, ~25MB).
 * Uses ONNX Runtime for CPU-based inference and Transformers.js for tokenization.
 *
 * Falls back gracefully if model download fails (returns null session).
 *
 * @example
 * ```typescript
 * const reranker = await initONNXReranker();
 * if (reranker.session) {
 *   const results = await rerankWithONNX(reranker, query, candidates, 12);
 * }
 * ```
 *
 * Model source: Xenova/ms-marco-MiniLM-L-6-v2 (industry standard for code search)
 */
export async function initONNXReranker(): Promise<ONNXReranker> {
  try {
    // Dynamic import to avoid loading onnxruntime-node at CLI startup
    const ort = await import('onnxruntime-node');

    // Model paths (opset 14 for compatibility with onnxruntime-node 1.24.1)
    const modelDir = '.oracle/models/Xenova/ms-marco-MiniLM-L-6-v2';
    const modelPath = join(modelDir, 'onnx', 'model.onnx');
    const tokenizerPath = join(modelDir, 'tokenizer.json');

    // Create model directory if it doesn't exist
    if (!existsSync(modelDir)) {
      mkdirSync(modelDir, { recursive: true });
    }
    if (!existsSync(join(modelDir, 'onnx'))) {
      mkdirSync(join(modelDir, 'onnx'), { recursive: true });
    }

    // Download model files on first use (opset 14 version from Hugging Face)
    if (!existsSync(modelPath) || !existsSync(tokenizerPath)) {
      console.log('Downloading cross-encoder model (one-time setup, ~25MB)...');

      // Download model.onnx (opset 14 - compatible with onnxruntime-node API versions 1-21)
      if (!existsSync(modelPath)) {
        const modelUrl =
          'https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/resolve/main/onnx/model.onnx';
        const modelResponse = await fetch(modelUrl);
        if (!modelResponse.ok) {
          throw new Error(`Failed to download model: ${modelResponse.statusText}`);
        }
        const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());
        const { writeFileSync } = await import('node:fs');
        writeFileSync(modelPath, modelBuffer);
      }

      // Download tokenizer.json
      if (!existsSync(tokenizerPath)) {
        const tokenizerUrl =
          'https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/resolve/main/tokenizer.json';
        const tokenizerResponse = await fetch(tokenizerUrl);
        if (!tokenizerResponse.ok) {
          throw new Error(`Failed to download tokenizer: ${tokenizerResponse.statusText}`);
        }
        const tokenizerBuffer = Buffer.from(await tokenizerResponse.arrayBuffer());
        const { writeFileSync } = await import('node:fs');
        writeFileSync(tokenizerPath, tokenizerBuffer);
      }

      console.log('Model downloaded successfully');
    }

    // Load ONNX session (opset 14 model)
    // Use executionProviders to limit API version to compatible range
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });

    // Load tokenizer from local directory
    const tokenizer = await AutoTokenizer.from_pretrained(modelDir);

    return { session, tokenizer };
  } catch (error) {
    console.warn('Failed to initialize ONNX reranker, falling back to passthrough:', error);
    return { session: null, tokenizer: null };
  }
}

/**
 * Rerank candidates using ONNX cross-encoder.
 *
 * Uses ms-marco-MiniLM-L6-v2 model to score query-document pairs for relevance.
 * Falls back gracefully if session is null (returns candidates as-is).
 *
 * @param reranker - Initialized ONNX reranker
 * @param query - Search query
 * @param candidates - Candidate chunks to rerank
 * @param topN - Number of top results to return (default: 12)
 * @returns Reranked results with relevance scores
 *
 * @example
 * ```typescript
 * const results = await rerankWithONNX(reranker, 'authentication', candidates, 10);
 * // Results sorted by relevance score (higher = more relevant)
 * ```
 */
export async function rerankWithONNX(
  reranker: ONNXReranker,
  query: string,
  candidates: RerankCandidate[],
  topN: number = 12,
): Promise<RerankResult[]> {
  // Graceful fallback if session not initialized
  if (!reranker.session || !reranker.tokenizer) {
    console.warn('ONNX reranker not initialized, returning candidates as-is');
    return candidates.slice(0, topN).map((c) => ({ id: c.id, score: 1.0 }));
  }

  try {
    // Score each candidate
    const scoredCandidates: Array<{ id: number; score: number }> = [];

    for (const candidate of candidates) {
      // Create query-document pair (truncate document to 512 tokens)
      const text = `${query} [SEP] ${candidate.content.slice(0, 2000)}`; // ~512 tokens

      // Tokenize
      const inputs = await reranker.tokenizer(text, {
        padding: true,
        truncation: true,
        max_length: 512,
        return_tensors: 'pt', // PyTorch-style tensors for ONNX
      });

      // Dynamic import for ONNX Runtime (lazy load)
      const ort = await import('onnxruntime-node');

      // Create ONNX tensor feeds
      const feeds: Record<string, ort.Tensor> = {
        input_ids: new ort.Tensor(
          'int64',
          BigInt64Array.from(inputs.input_ids.data.map((x: number) => BigInt(x))),
          inputs.input_ids.dims,
        ),
        attention_mask: new ort.Tensor(
          'int64',
          BigInt64Array.from(inputs.attention_mask.data.map((x: number) => BigInt(x))),
          inputs.attention_mask.dims,
        ),
        token_type_ids: new ort.Tensor(
          'int64',
          BigInt64Array.from(
            inputs.token_type_ids?.data?.map((x: number) => BigInt(x)) ||
              new Array(inputs.input_ids.data.length).fill(0),
          ),
          inputs.token_type_ids?.dims || inputs.input_ids.dims,
        ),
      };

      // Run inference
      const output = await reranker.session.run(feeds);

      // Extract relevance score from logits
      // Cross-encoder outputs single relevance score
      const logits = output.logits;
      const score = Array.from(logits.data as Float32Array)[0];

      scoredCandidates.push({ id: candidate.id, score });
    }

    // Sort by score (descending) and return top N
    const ranked = scoredCandidates.sort((a, b) => b.score - a.score).slice(0, topN);

    return ranked;
  } catch (error) {
    console.warn('ONNX inference failed, returning candidates as-is:', error);
    return candidates.slice(0, topN).map((c) => ({ id: c.id, score: 1.0 }));
  }
}
