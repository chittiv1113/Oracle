import { describe, it, expect } from 'vitest';
import { extractCitations, validateCitations } from '../../src/generation/citations.js';
import type { SearchResult } from '../../src/search/search.js';

describe('extractCitations', () => {
  it('should extract single line citation', () => {
    const response = 'The code is in [file.ts:10]';
    const citations = extractCitations(response);

    expect(citations).toHaveLength(1);
    expect(citations[0]).toEqual({
      filePath: 'file.ts',
      startLine: 10,
      endLine: undefined,
      rawText: '[file.ts:10]',
    });
  });

  it('should extract line range citation', () => {
    const response = 'See [src/auth/login.ts:10-20] for details';
    const citations = extractCitations(response);

    expect(citations).toHaveLength(1);
    expect(citations[0]).toEqual({
      filePath: 'src/auth/login.ts',
      startLine: 10,
      endLine: 20,
      rawText: '[src/auth/login.ts:10-20]',
    });
  });

  it('should extract multiple citations', () => {
    const response = 'Auth is in [auth.ts:10-20] and config in [config.ts:5]';
    const citations = extractCitations(response);

    expect(citations).toHaveLength(2);
    expect(citations[0].filePath).toBe('auth.ts');
    expect(citations[1].filePath).toBe('config.ts');
  });

  it('should return empty array when no citations', () => {
    const response = 'This response has no citations';
    const citations = extractCitations(response);

    expect(citations).toHaveLength(0);
  });

  it('should handle malformed citations gracefully', () => {
    const response = 'Bad citation [file.ts] and [file:abc] but good [file.ts:10]';
    const citations = extractCitations(response);

    // Only the well-formed citation should be extracted
    expect(citations).toHaveLength(1);
    expect(citations[0].filePath).toBe('file.ts');
    expect(citations[0].startLine).toBe(10);
  });
});

describe('validateCitations', () => {
  const mockChunks: SearchResult[] = [
    {
      id: 1,
      filePath: 'src/auth.ts',
      symbolName: 'login',
      content: 'function login() { ... }',
      startLine: 10,
      endLine: 25,
      score: 1.0,
    },
    {
      id: 2,
      filePath: 'src/config.ts',
      symbolName: 'CONFIG',
      content: 'const CONFIG = { ... }',
      startLine: 1,
      endLine: 10,
      score: 0.9,
    },
  ];

  it('should validate citations within chunk ranges', () => {
    const citations = [
      {
        filePath: 'src/auth.ts',
        startLine: 10,
        endLine: 20,
        rawText: '[src/auth.ts:10-20]',
      },
    ];

    const valid = validateCitations(citations, mockChunks);
    expect(valid).toBe(true);
  });

  it('should detect citations outside chunk ranges', () => {
    const citations = [
      {
        filePath: 'src/auth.ts',
        startLine: 30, // Outside chunk (10-25)
        endLine: undefined,
        rawText: '[src/auth.ts:30]',
      },
    ];

    // Suppress console.warn for this test
    const originalWarn = console.warn;
    console.warn = () => {};

    const valid = validateCitations(citations, mockChunks);
    expect(valid).toBe(false);

    console.warn = originalWarn;
  });

  it('should detect citations to non-existent files', () => {
    const citations = [
      {
        filePath: 'src/nonexistent.ts',
        startLine: 10,
        endLine: undefined,
        rawText: '[src/nonexistent.ts:10]',
      },
    ];

    // Suppress console.warn for this test
    const originalWarn = console.warn;
    console.warn = () => {};

    const valid = validateCitations(citations, mockChunks);
    expect(valid).toBe(false);

    console.warn = originalWarn;
  });

  it('should return true for empty citations array', () => {
    const valid = validateCitations([], mockChunks);
    expect(valid).toBe(true);
  });

  it('should validate single line citations', () => {
    const citations = [
      {
        filePath: 'src/config.ts',
        startLine: 5,
        endLine: undefined,
        rawText: '[src/config.ts:5]',
      },
    ];

    const valid = validateCitations(citations, mockChunks);
    expect(valid).toBe(true);
  });

  it('should return false if any citation is invalid', () => {
    const citations = [
      {
        filePath: 'src/auth.ts',
        startLine: 10,
        endLine: undefined,
        rawText: '[src/auth.ts:10]',
      },
      {
        filePath: 'src/fake.ts', // Invalid
        startLine: 1,
        endLine: undefined,
        rawText: '[src/fake.ts:1]',
      },
    ];

    // Suppress console.warn for this test
    const originalWarn = console.warn;
    console.warn = () => {};

    const valid = validateCitations(citations, mockChunks);
    expect(valid).toBe(false);

    console.warn = originalWarn;
  });
});
