/**
 * RAG prompt templates with XML structure for grounded code Q&A.
 *
 * Implements prompt engineering patterns from Anthropic research:
 * - XML tags for multi-component prompts (+15% recall)
 * - Explicit grounding rules to prevent hallucination
 * - Chunk metadata embedded for citation extraction
 * - Consistent tag names across prompts
 *
 * Based on official patterns from:
 * https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags
 */

import type { SearchResult } from '../search/search.js';

/**
 * Build RAG prompt with XML structure for grounded code Q&A.
 *
 * Structure:
 * 1. System instructions with grounding rules
 * 2. Context section with code chunks in XML tags
 * 3. Question section
 * 4. Citation requirements
 *
 * XML tag format for chunks:
 * ```xml
 * <chunk id="1" file="path/to/file.ts" lines="10-25">
 * [chunk.content]
 * </chunk>
 * ```
 *
 * Grounding instructions:
 * - Answer ONLY using provided code chunks
 * - Cite sources using [file.ts:10-20] format
 * - Admit uncertainty when chunks lack information
 * - Quote relevant code snippets
 * - Do NOT use general programming knowledge
 *
 * Edge cases:
 * - Empty chunks: Returns prompt with "no context available" instruction
 * - Empty query: Returns empty string (caller should validate)
 *
 * @param query - User's question about the codebase
 * @param chunks - Retrieved code chunks from hybrid search with metadata
 * @returns Formatted prompt string with XML structure
 *
 * @example
 * ```typescript
 * const chunks = await hybridSearch(query, db, bm25Index, vectorIndex, embedder);
 * const prompt = buildRAGPrompt('How does authentication work?', chunks);
 * const messages = [{ role: 'user', content: prompt }];
 * const response = await streamAnthropicResponse(client, messages);
 * ```
 */
export function buildRAGPrompt(query: string, chunks: SearchResult[]): string {
  // Edge case: empty query
  if (!query || query.trim() === '') {
    return '';
  }

  // Edge case: empty chunks
  if (chunks.length === 0) {
    return `You are a code assistant answering questions about a repository.

<instructions>
1. No code chunks were found for this query
2. Inform the user that the search didn't return relevant results
3. Suggest they rephrase their question or ask about a different topic
4. Do NOT use your general programming knowledge - only work with provided code
</instructions>

<question>
${query}
</question>

Answer the question above, explaining that no relevant code was found.`;
  }

  // Build context XML from chunks
  // Format: <chunk id="N" file="path/to/file.ts" lines="10-25">content</chunk>
  const contextXML = chunks
    .map(
      (
        chunk,
        idx,
      ) => `<chunk id="${idx + 1}" file="${chunk.filePath}" lines="${chunk.startLine}-${chunk.endLine}">
${chunk.content}
</chunk>`,
    )
    .join('\n\n');

  // Assemble full prompt with XML structure
  // Pattern from research: XML tags help Claude parse multi-component prompts
  return `You are a code assistant answering questions about a repository.

<instructions>
1. Answer ONLY using information from the provided code chunks
2. Cite your sources using the format: [file.ts:10-20]
3. If the chunks don't contain enough information, say "I don't have enough context to answer that"
4. Quote relevant code snippets when helpful
5. Do NOT use your general programming knowledge - stick to the provided code
</instructions>

<context>
${contextXML}
</context>

<question>
${query}
</question>

Answer the question above following the instructions. Include citations for every claim.`;
}
