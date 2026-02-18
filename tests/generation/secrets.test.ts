/**
 * Unit tests for secret detection and redaction.
 */

import { describe, it, expect, vi } from 'vitest';
import { redactSecrets, prepareChunksForAPI } from '../../src/generation/secrets.js';
import type { SearchResult } from '../../src/search/search.js';

describe('redactSecrets', () => {
  it('detects and replaces AWS access keys', () => {
    const content = 'const awsKey = "AKIAIOSFODNN7EXAMPLE";';
    const result = redactSecrets(content);

    expect(result.foundSecrets).toContain('AWS_ACCESS_KEY');
    expect(result.redacted).toContain('[REDACTED_AWS_ACCESS_KEY]');
    expect(result.redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('detects and replaces OpenAI API keys', () => {
    const content = 'OPENAI_API_KEY=sk-abcdefgh12345678901234567890abcd';
    const result = redactSecrets(content);

    expect(result.foundSecrets).toContain('OPENAI_KEY');
    expect(result.redacted).toContain('[REDACTED_OPENAI_KEY]');
    expect(result.redacted).not.toContain('sk-abcdefgh');
  });

  it('detects and replaces Anthropic API keys', () => {
    const content = 'const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890";';
    const result = redactSecrets(content);

    expect(result.foundSecrets).toContain('ANTHROPIC_KEY');
    expect(result.redacted).toContain('[REDACTED_ANTHROPIC_KEY]');
  });

  it('detects and replaces GitHub tokens', () => {
    const content = 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const result = redactSecrets(content);

    expect(result.foundSecrets).toContain('GITHUB_TOKEN');
    expect(result.redacted).toContain('[REDACTED_GITHUB_TOKEN]');
  });

  it('detects and replaces JWT tokens', () => {
    const content =
      'token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = redactSecrets(content);

    expect(result.foundSecrets).toContain('JWT_TOKEN');
    expect(result.redacted).toContain('[REDACTED_JWT_TOKEN]');
  });

  it('detects and replaces database connection strings', () => {
    const content = 'DATABASE_URL=postgres://user:password@localhost:5432/db';
    const result = redactSecrets(content);

    expect(result.foundSecrets).toContain('DB_CONNECTION');
    expect(result.redacted).toContain('[REDACTED_DB_CONNECTION]');
  });

  it('detects and replaces private keys', () => {
    const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...';
    const result = redactSecrets(content);

    expect(result.foundSecrets).toContain('PRIVATE_KEY');
    expect(result.redacted).toContain('[REDACTED_PRIVATE_KEY]');
  });

  it('detects and replaces Slack tokens', () => {
    const content =
      'SLACK_TOKEN=xoxb-1234567890-1234567890-1234567890-abcdefghijklmnopqrstuvwxyz123456';
    const result = redactSecrets(content);

    expect(result.foundSecrets).toContain('SLACK_TOKEN');
    expect(result.redacted).toContain('[REDACTED_SLACK_TOKEN]');
  });

  it('returns original content when no secrets found', () => {
    const content = 'const name = "John Doe";\nconst age = 30;';
    const result = redactSecrets(content);

    expect(result.foundSecrets).toHaveLength(0);
    expect(result.redacted).toBe(content);
  });

  it('detects multiple secret types in one chunk', () => {
    const content = `
      const awsKey = "AKIAIOSFODNN7EXAMPLE";
      const openaiKey = "sk-abcdefghijklmnopqrstuvwxyz123456";
      const githubToken = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    `;
    const result = redactSecrets(content);

    expect(result.foundSecrets).toContain('AWS_ACCESS_KEY');
    expect(result.foundSecrets).toContain('OPENAI_KEY');
    expect(result.foundSecrets).toContain('GITHUB_TOKEN');
    expect(result.foundSecrets.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves code structure with placeholders', () => {
    const content = 'const apiKey = "AKIAIOSFODNN7EXAMPLE";';
    const result = redactSecrets(content);

    expect(result.redacted).toBe('const apiKey = "[REDACTED_AWS_ACCESS_KEY]";');
  });
});

describe('prepareChunksForAPI', () => {
  it('redacts secrets from chunk content', () => {
    const chunks: SearchResult[] = [
      {
        id: 1,
        filePath: 'config.ts',
        symbolName: 'API_KEY',
        content: 'const apiKey = "AKIAIOSFODNN7EXAMPLE";',
        startLine: 10,
        endLine: 10,
        score: 0.95,
      },
    ];

    const result = prepareChunksForAPI(chunks);

    expect(result[0].content).toContain('[REDACTED_AWS_ACCESS_KEY]');
    expect(result[0].content).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('warns when secrets are detected', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const chunks: SearchResult[] = [
      {
        id: 1,
        filePath: 'auth.ts',
        symbolName: 'getToken',
        content: 'const token = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890";',
        startLine: 15,
        endLine: 15,
        score: 0.9,
      },
    ];

    prepareChunksForAPI(chunks);

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Redacted'));
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('auth.ts:15'));

    consoleWarnSpy.mockRestore();
  });

  it('returns chunks unchanged when no secrets found', () => {
    const chunks: SearchResult[] = [
      {
        id: 1,
        filePath: 'utils.ts',
        symbolName: 'formatName',
        content: 'function formatName(name: string) { return name.trim(); }',
        startLine: 5,
        endLine: 7,
        score: 0.8,
      },
    ];

    const result = prepareChunksForAPI(chunks);

    expect(result[0].content).toBe(chunks[0].content);
  });

  it('processes multiple chunks independently', () => {
    const chunks: SearchResult[] = [
      {
        id: 1,
        filePath: 'config.ts',
        symbolName: 'AWS_KEY',
        content: 'const awsKey = "AKIAIOSFODNN7EXAMPLE";',
        startLine: 10,
        endLine: 10,
        score: 0.95,
      },
      {
        id: 2,
        filePath: 'utils.ts',
        symbolName: 'formatName',
        content: 'function formatName(name: string) { return name.trim(); }',
        startLine: 5,
        endLine: 7,
        score: 0.8,
      },
    ];

    const result = prepareChunksForAPI(chunks);

    expect(result[0].content).toContain('[REDACTED_AWS_ACCESS_KEY]');
    expect(result[1].content).toBe(chunks[1].content);
  });
});
