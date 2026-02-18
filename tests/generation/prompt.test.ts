/**
 * Tests for RAG prompt building with XML structure.
 */

import { describe, it, expect } from 'vitest';
import { buildRAGPrompt } from '../../src/generation/prompt.js';
import type { SearchResult } from '../../src/search/search.js';

describe('buildRAGPrompt', () => {
  it('should generate XML-structured prompt with sample chunks', () => {
    const chunks: SearchResult[] = [
      {
        id: 1,
        filePath: 'src/auth/login.ts',
        symbolName: 'authenticateUser',
        content:
          'export function authenticateUser(username: string, password: string) {\n  // Implementation\n}',
        startLine: 10,
        endLine: 20,
        score: 0.95,
      },
      {
        id: 2,
        filePath: 'src/auth/jwt.ts',
        symbolName: 'generateToken',
        content: 'export function generateToken(userId: number) {\n  // JWT generation\n}',
        startLine: 5,
        endLine: 15,
        score: 0.85,
      },
    ];

    const prompt = buildRAGPrompt('How does authentication work?', chunks);

    // Verify prompt structure
    expect(prompt).toContain('<instructions>');
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('<question>');

    // Verify chunk metadata embedded
    expect(prompt).toContain('<chunk id="1" file="src/auth/login.ts" lines="10-20">');
    expect(prompt).toContain('<chunk id="2" file="src/auth/jwt.ts" lines="5-15">');

    // Verify chunk content included
    expect(prompt).toContain('authenticateUser');
    expect(prompt).toContain('generateToken');

    // Verify grounding instructions
    expect(prompt).toContain('Answer ONLY using information from the provided code chunks');
    expect(prompt).toContain('Cite your sources using the format: [file.ts:10-20]');
    expect(prompt).toContain("I don't have enough context to answer that");

    // Verify question included
    expect(prompt).toContain('How does authentication work?');
  });

  it('should handle empty chunks gracefully', () => {
    const prompt = buildRAGPrompt('What is the main function?', []);

    // Verify it returns a prompt (not empty)
    expect(prompt).toBeTruthy();

    // Verify it instructs about no results
    expect(prompt).toContain('No code chunks were found');
    expect(prompt).toContain("search didn't return relevant results");

    // Verify question still included
    expect(prompt).toContain('What is the main function?');
  });

  it('should handle empty query', () => {
    const chunks: SearchResult[] = [
      {
        id: 1,
        filePath: 'src/test.ts',
        symbolName: 'test',
        content: 'test content',
        startLine: 1,
        endLine: 5,
        score: 1.0,
      },
    ];

    const prompt = buildRAGPrompt('', chunks);

    // Empty query returns empty string
    expect(prompt).toBe('');
  });
});
