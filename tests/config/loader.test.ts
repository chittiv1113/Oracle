/**
 * Unit tests for configuration loader.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';

describe('loadConfig', () => {
  // Store original env vars to restore after tests
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear config-related env vars before each test
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.COHERE_API_KEY;
  });

  afterEach(() => {
    // Restore original env vars
    process.env = { ...originalEnv };
  });

  it('returns defaults when no env vars or config file', async () => {
    const config = await loadConfig();

    expect(config.anthropic?.apiKey).toBeUndefined();
    expect(config.anthropic?.model).toBe('claude-sonnet-4-5-20250929');
    expect(config.anthropic?.maxTokens).toBe(4096);
    expect(config.cohere?.apiKey).toBeUndefined();
  });

  it('uses env var ANTHROPIC_API_KEY when set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123';

    const config = await loadConfig();

    expect(config.anthropic?.apiKey).toBe('sk-ant-test-key-123');
  });

  it('uses env var COHERE_API_KEY when set', async () => {
    process.env.COHERE_API_KEY = 'cohere-test-key-456';

    const config = await loadConfig();

    expect(config.cohere?.apiKey).toBe('cohere-test-key-456');
  });

  it('returns config with all expected properties', async () => {
    const config = await loadConfig();

    // Structure validation
    expect(config).toHaveProperty('anthropic');
    expect(config).toHaveProperty('cohere');
    expect(config.anthropic).toHaveProperty('apiKey');
    expect(config.anthropic).toHaveProperty('model');
    expect(config.anthropic).toHaveProperty('maxTokens');
    expect(config.cohere).toHaveProperty('apiKey');
  });

  it('env var takes precedence over defaults', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';

    const config = await loadConfig();

    // Env var should override default (which is undefined)
    expect(config.anthropic?.apiKey).toBe('env-key');
  });

  it('handles missing .env file gracefully', async () => {
    // No .env file in test environment - should not throw
    const config = await loadConfig();

    // Should return valid config with defaults
    expect(config).toBeDefined();
    expect(config.anthropic?.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('returns undefined apiKey when not configured', async () => {
    const config = await loadConfig();

    // No env var, no config file - should be undefined for graceful degradation
    expect(config.anthropic?.apiKey).toBeUndefined();
    expect(config.cohere?.apiKey).toBeUndefined();
  });
});
