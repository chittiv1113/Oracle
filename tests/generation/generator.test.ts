import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateAnswer } from '../../src/generation/generator.js';
import type { SearchResult } from '../../src/search/search.js';

describe('generateAnswer', () => {
  const mockChunks: SearchResult[] = [
    {
      id: 1,
      filePath: 'src/auth.ts',
      symbolName: 'login',
      content:
        'function login(user: string, pass: string) {\n  return authenticate(user, pass);\n}',
      startLine: 10,
      endLine: 12,
      score: 1.0,
    },
    {
      id: 2,
      filePath: 'src/config.ts',
      symbolName: 'CONFIG',
      content: 'export const CONFIG = {\n  apiUrl: "https://api.example.com"\n};',
      startLine: 1,
      endLine: 3,
      score: 0.9,
    },
  ];

  // Capture console output for testing
  let consoleOutput: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    consoleOutput = [];
    console.log = vi.fn((...args) => {
      consoleOutput.push(args.join(' '));
    });
    console.warn = vi.fn((...args) => {
      consoleOutput.push(args.join(' '));
    });
    console.error = vi.fn((...args) => {
      consoleOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  it('should display fallback message when client is null', async () => {
    await generateAnswer('How does authentication work?', mockChunks, null);

    // Check for key fallback messages
    const output = consoleOutput.join('\n');
    expect(output).toContain('No LLM provider configured');
    expect(output).toContain('API key');
    expect(output).toContain('Retrieved chunks');
  });

  it('should display top 5 chunks in fallback mode', async () => {
    await generateAnswer('test query', mockChunks, null);

    const output = consoleOutput.join('\n');
    // Should show chunk file paths
    expect(output).toContain('src/auth.ts');
    expect(output).toContain('src/config.ts');
  });

  it('should show total chunk count in fallback mode', async () => {
    await generateAnswer('test query', mockChunks, null);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Found 2 total chunks');
  });

  it('should handle empty chunks in fallback mode', async () => {
    await generateAnswer('test query', [], null);

    const output = consoleOutput.join('\n');
    expect(output).toContain('No LLM provider configured');
    expect(output).toContain('Found 0 total chunks');
  });
});
