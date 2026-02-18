/**
 * Ask command: Interactive question-answering using RAG pipeline.
 *
 * Pipeline flow:
 * 1. Load configuration (API keys, model settings)
 * 2. Initialize all clients (DB, BM25, Vector, Embedder, Reranker, Anthropic)
 * 3. Hybrid search retrieval (BM25 + Vector + RRF fusion)
 * 4. Reranking (Cohere or ONNX fallback)
 * 5. Generate answer with streaming output
 *
 * Graceful degradation:
 * - No Anthropic API key: Show retrieved chunks (retrieval-only mode)
 * - No Cohere API key: Fall back to ONNX reranker
 * - No search results: Inform user to rephrase query
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { initDatabase, DEFAULT_DB_PATH } from '../../persistence/schema.js';
import { loadBM25Index } from '../../search/bm25/persistence.js';
import { loadVectorIndex, DEFAULT_VECTOR_INDEX_PATH } from '../../search/vector/persistence.js';
import { initEmbedder } from '../../search/vector/embedder.js';
import { initReranker, rerank } from '../../search/reranking/reranker.js';
import { hybridSearch } from '../../search/search.js';
import { initLLMProvider } from '../../generation/provider-factory.js';
import { generateAnswer } from '../../generation/generator.js';
import { shouldBypassRAG } from '../../generation/token-counter.js';
import { loadConfig } from '../../config/loader.js';
import { runConfigWizard } from './config.js';
import type { Database } from 'better-sqlite3';

interface AskOptions {
  rerank: boolean;
  topK: string;
  cache: boolean;
  dryRun: boolean;
}

// Database reference for signal handlers
let db: Database | null = null;

process.on('SIGINT', () => {
  console.log('\n\nInterrupted by user.');
  if (db) db.close();
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n\nTerminated.');
  if (db) db.close();
  process.exit(143);
});

export const askCommand = new Command('ask')
  .description('Ask a question about the repository')
  .argument('<question>', 'The question to ask')
  .option('--no-rerank', 'Skip reranking (faster but lower quality)')
  .option('--top-k <number>', 'Number of chunks to use for answer generation', '12')
  .option('--dry-run', 'Show what would be sent to LLM without making API call')
  .option('--no-cache', 'Skip cache lookup and always query LLM')
  .addHelpText(
    'after',
    `

Examples:
  # Ask a question
  $ oracle ask "How does authentication work?"

  # Skip reranking for faster results
  $ oracle ask "Where is the main function?" --no-rerank

  # Use more chunks for complex questions
  $ oracle ask "Explain the entire auth flow" --top-k 20

  # Preview what would be sent to LLM
  $ oracle ask "How does caching work?" --dry-run

  # Force fresh response (bypass cache)
  $ oracle ask "What changed recently?" --no-cache

Notes:
  - Requires indexed repository (run 'oracle index' first)
  - Requires configured LLM provider (Anthropic, OpenAI, or Ollama)
  - Answers include file citations with line numbers
  - Identical questions return cached responses instantly
`,
  )
  .action(async (question: string, options: AskOptions) => {
    const topK = parseInt(options.topK, 10);

    // Validate topK
    if (isNaN(topK) || topK < 1) {
      console.error('Error: --top-k must be a positive number');
      process.exit(1);
    }

    try {
      // STEP 1: Load configuration and check if provider configured
      let config = await loadConfig();

      // Check if provider is configured
      const hasProvider =
        (config.llm?.provider === 'anthropic' && config.anthropic?.apiKey) ||
        (config.llm?.provider === 'openai' && config.openai?.apiKey) ||
        (config.llm?.provider === 'ollama' && config.ollama?.model);

      if (!hasProvider) {
        console.log(chalk.yellow('⚠️  No LLM provider configured.'));
        console.log('Running configuration wizard...\n');
        await runConfigWizard();
        // Reload config after wizard completes
        config = await loadConfig();
      }

      // STEP 2: Initialize all clients
      console.log(chalk.blue('ℹ️  Initializing...'));

      // Database
      db = initDatabase(DEFAULT_DB_PATH);

      // BM25 index
      const bm25Index = await loadBM25Index('.oracle/bm25.msp');
      if (!bm25Index) {
        console.error(chalk.red('❌ Error: BM25 index not found. Run `oracle index` first.'));
        process.exit(1);
      }

      // Vector index
      const vectorIndex = await loadVectorIndex(DEFAULT_VECTOR_INDEX_PATH);
      if (!vectorIndex) {
        console.error(chalk.red('❌ Error: Vector index not found. Run `oracle index` first.'));
        process.exit(1);
      }

      // Embedder (for query embedding)
      const embedder = await initEmbedder();

      // Reranker (Cohere or ONNX fallback)
      const reranker = await initReranker(config.cohere?.apiKey);

      // LLM provider (may be null if not configured)
      const llmProvider = initLLMProvider(config);

      // Display active provider with clear error if unavailable
      if (!llmProvider) {
        console.error(chalk.red('✗ Provider unavailable:'));
        if (config.llm?.provider === 'anthropic') {
          console.error('  Missing ANTHROPIC_API_KEY');
          console.error('  Run `oracle config` to configure or set environment variable');
        } else if (config.llm?.provider === 'openai') {
          console.error('  Missing OPENAI_API_KEY');
          console.error('  Run `oracle config` to configure or set environment variable');
        } else if (config.llm?.provider === 'ollama') {
          console.error('  Ollama not configured');
          console.error('  Run `oracle config` to configure Ollama model');
        }
        process.exit(1);
      }

      // Display active provider and model
      const modelName = llmProvider.config?.model || 'default model';
      console.log(chalk.blue(`Using ${llmProvider.name} ${modelName}...\n`));

      // STEP 2.5: Check if small repository should bypass RAG
      const bypassResult = await shouldBypassRAG(db, llmProvider, 50_000);

      if (bypassResult.bypass) {
        console.log(
          chalk.blue(
            `ℹ️  Small codebase detected (${bypassResult.tokenCount.toLocaleString()} tokens)`,
          ),
        );
        console.log(chalk.blue(`ℹ️  Sending full repository to LLM (bypassing RAG)\n`));

        // Build full context prompt and generate answer
        console.log(chalk.bold('Answer:\n'));
        await generateAnswer(question, [], llmProvider, {
          fullCodebase: bypassResult.fullText,
          dryRun: options.dryRun,
          noCache: options.cache === false,
        });
        return;
      }

      // STEP 3: Hybrid search retrieval
      console.log(chalk.blue('ℹ️  Searching...'));

      const searchResults = await hybridSearch(question, db, bm25Index, vectorIndex, embedder, {
        fusionLimit: 30, // Get 30 candidates for reranking
      });

      // Check if we got any results
      if (searchResults.length === 0) {
        console.log(chalk.yellow('\n⚠️  No relevant code found for your question.'));
        console.log('Try rephrasing your question or ask about a different topic.');
        process.exit(0);
      }

      // STEP 4: Reranking (if enabled)
      let topChunks;

      if (options.rerank) {
        // Convert search results to reranker candidates
        const rerankCandidates = searchResults.map((r) => ({
          id: r.id,
          content: r.content,
        }));

        // Rerank to select top-k chunks
        const rerankedResults = await rerank(reranker, question, rerankCandidates, topK);

        // Map back to full chunks
        topChunks = rerankedResults
          .map((r) => searchResults.find((s) => s.id === r.id))
          .filter((c): c is (typeof searchResults)[number] => c !== undefined);
      } else {
        // Skip reranking - take top-k from fusion results
        topChunks = searchResults.slice(0, topK);
      }

      // STEP 5: Generate answer
      console.log(chalk.bold('\nAnswer:\n'));
      await generateAnswer(question, topChunks, llmProvider, {
        noCache: options.cache === false, // Commander converts --no-cache to cache: false
        dryRun: options.dryRun,
      });
    } catch (error) {
      console.error(
        chalk.red('\n❌ Error:'),
        error instanceof Error ? error.message : 'Unknown error',
      );
      process.exit(1);
    }
  });
