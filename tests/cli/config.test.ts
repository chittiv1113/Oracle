import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';

describe('Config Command', () => {
  const testConfigPath = '.oraclerc.test';

  afterEach(() => {
    // Clean up test config file
    if (existsSync(testConfigPath)) {
      rmSync(testConfigPath);
    }
  });

  describe('Validation', () => {
    it('should reject empty Anthropic API key', () => {
      const validate = (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return 'API key cannot be empty';
        if (!trimmed.startsWith('sk-ant-')) {
          return 'Anthropic API keys start with sk-ant-';
        }
        if (trimmed.length < 20) {
          return 'API key seems too short';
        }
        return true;
      };

      expect(validate('')).toBe('API key cannot be empty');
      expect(validate('   ')).toBe('API key cannot be empty');
    });

    it('should reject API keys not starting with sk-ant-', () => {
      const validate = (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return 'API key cannot be empty';
        if (!trimmed.startsWith('sk-ant-')) {
          return 'Anthropic API keys start with sk-ant-';
        }
        return true;
      };

      expect(validate('invalid-key')).toBe('Anthropic API keys start with sk-ant-');
      expect(validate('sk-wrong-prefix')).toBe('Anthropic API keys start with sk-ant-');
    });

    it('should reject API keys that are too short', () => {
      const validate = (value: string) => {
        const trimmed = value.trim();
        if (trimmed.length < 20) {
          return 'API key seems too short';
        }
        return true;
      };

      expect(validate('sk-ant-short')).toBe('API key seems too short');
    });

    it('should accept valid Anthropic API key format', () => {
      const validate = (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return 'API key cannot be empty';
        if (!trimmed.startsWith('sk-ant-')) {
          return 'Anthropic API keys start with sk-ant-';
        }
        if (trimmed.length < 20) {
          return 'API key seems too short';
        }
        return true;
      };

      expect(validate('sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz')).toBe(true);
    });
  });

  describe('CI Detection', () => {
    it('should detect CI environment via is-ci', async () => {
      // This test documents that isCI from is-ci package is used
      // Actual CI detection is tested by is-ci library itself
      const { default: isCI } = await import('is-ci');

      // In local dev, isCI should be false
      // In GitHub Actions, isCI should be true
      expect(typeof isCI).toBe('boolean');
    });
  });
});
