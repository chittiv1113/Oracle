/**
 * Secret detection and redaction module.
 *
 * Scans code chunks for sensitive patterns (API keys, tokens, passwords, etc.)
 * and replaces them with placeholders before external transmission.
 *
 * CRITICAL: This module MUST be used before sending any code to external APIs.
 * Pattern: redact chunks → build prompt → send to API
 *
 * Based on research recommendations from Phase 4 research:
 * - Regex-based detection (offline, no API calls)
 * - Top 20+ most common secret patterns
 * - Placeholder replacement preserving code structure
 */

import type { SearchResult } from '../search/search.js';

/**
 * Secret pattern definition.
 */
interface SecretPattern {
  /** Pattern name for logging and placeholders */
  name: string;
  /** Regex pattern to detect secret */
  regex: RegExp;
}

/**
 * Top 20+ most common secret patterns from open-source databases.
 *
 * Sources:
 * - https://github.com/h33tlit/secret-regex-list (1600+ patterns)
 * - https://github.com/mazen160/secrets-patterns-db
 *
 * IMPORTANT: Patterns are ordered from most specific to least specific.
 * More specific patterns must be checked first to avoid generic patterns
 * matching and replacing before specific ones can detect.
 *
 * Note: Patterns use case-insensitive flag where appropriate.
 * False positives are acceptable - better safe than leaking secrets.
 */
const SECRET_PATTERNS: SecretPattern[] = [
  // SPECIFIC PATTERNS FIRST (ordered by specificity)

  // Anthropic Keys (very specific format)
  {
    name: 'ANTHROPIC_KEY',
    regex: /sk-ant-[A-Za-z0-9\-_]{40,}/g,
  },

  // OpenAI Keys (very specific format)
  {
    name: 'OPENAI_KEY',
    regex: /sk-[A-Za-z0-9]{32,}/g,
  },

  // AWS Credentials
  {
    name: 'AWS_ACCESS_KEY',
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: 'AWS_SECRET_KEY',
    regex: /aws[_-]?secret[_-]?access[_-]?key['"\s:=]+([a-zA-Z0-9/+=]{40})/gi,
  },

  // Slack Tokens (specific format)
  {
    name: 'SLACK_TOKEN',
    regex: /xox[pboa]-[0-9]{10,12}-[0-9]{10,12}-[0-9]{10,12}-[a-z0-9]{32}/g,
  },
  {
    name: 'SLACK_WEBHOOK',
    regex:
      /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8,}\/B[a-zA-Z0-9_]{8,}\/[a-zA-Z0-9_]{24,}/g,
  },

  // GitHub Tokens (specific format)
  {
    name: 'GITHUB_PAT',
    regex: /github_pat_[a-zA-Z0-9_]{82}/g,
  },
  {
    name: 'GITHUB_TOKEN',
    regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
  },

  // JWT Tokens (very specific format)
  {
    name: 'JWT_TOKEN',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },

  // Stripe Keys
  {
    name: 'STRIPE_KEY',
    regex: /(?:sk|pk)_live_[0-9a-zA-Z]{24,}/g,
  },

  // Google API Keys
  {
    name: 'GOOGLE_API_KEY',
    regex: /AIza[0-9A-Za-z\-_]{35}/g,
  },

  // SendGrid API Keys
  {
    name: 'SENDGRID_KEY',
    regex: /SG\.[0-9A-Za-z\-_]{22}\.[0-9A-Za-z\-_]{43}/g,
  },

  // Twilio Keys
  {
    name: 'TWILIO_KEY',
    regex: /SK[0-9a-fA-F]{32}/g,
  },

  // NPM Tokens
  {
    name: 'NPM_TOKEN',
    regex: /npm_[A-Za-z0-9]{36}/g,
  },

  // PyPI Tokens
  {
    name: 'PYPI_TOKEN',
    regex: /pypi-[A-Za-z0-9\-_]{32,}/g,
  },

  // Facebook Access Tokens
  {
    name: 'FACEBOOK_TOKEN',
    regex: /EAACEdEose0cBA[0-9A-Za-z]+/g,
  },

  // Twitter Bearer Tokens
  {
    name: 'TWITTER_TOKEN',
    regex: /AAAA[0-9A-Za-z%]{90,}/g,
  },

  // MailChimp API Keys
  {
    name: 'MAILCHIMP_KEY',
    regex: /[0-9a-f]{32}-us[0-9]{1,2}/g,
  },

  // Heroku API Keys
  {
    name: 'HEROKU_KEY',
    regex: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
  },

  // Private Keys
  {
    name: 'PRIVATE_KEY',
    regex: /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/g,
  },

  // Database Connection Strings
  {
    name: 'DB_CONNECTION',
    regex: /(?:mongodb|postgres|mysql|mariadb|redis):\/\/[^\s/]+:[^\s/@]+@[^\s]+/gi,
  },

  // Azure Keys (broader pattern, check after specific keys)
  {
    name: 'AZURE_KEY',
    regex: /[a-zA-Z0-9/+=]{88}==/g,
  },

  // GENERIC PATTERNS LAST (catch-all patterns)

  // Generic API Keys (after specific API key patterns)
  {
    name: 'GENERIC_API_KEY',
    regex: /(?:api[_-]?key|apikey)['"\s:=]+([a-zA-Z0-9\-_.]{16,100})/gi,
  },

  // Generic Secrets/Tokens/Passwords (very last - broadest pattern)
  {
    name: 'GENERIC_SECRET',
    regex: /(?:secret|token|password)['"\s:=]+([a-zA-Z0-9\-_.]{8,100})/gi,
  },
];

/**
 * Result of secret redaction.
 */
interface RedactionResult {
  /** Content with secrets replaced by placeholders */
  redacted: string;
  /** Names of detected secret patterns */
  foundSecrets: string[];
}

/**
 * Scans content for secrets using regex patterns and replaces with placeholders.
 *
 * Placeholders use format: [REDACTED_PATTERN_NAME]
 * This preserves code structure (e.g., const key = [REDACTED_API_KEY])
 *
 * Edge cases:
 * - No secrets found: Returns original content unchanged
 * - Multiple secret types: Redacts all, lists all in foundSecrets
 * - False positives: Acceptable - better safe than leaking secrets
 *
 * @param content - Text content to scan (code chunk, prompt, etc.)
 * @returns Redaction result with replaced content and detected pattern names
 *
 * @example
 * ```typescript
 * const { redacted, foundSecrets } = redactSecrets('const key = "sk-abc123..."');
 * // redacted: 'const key = "[REDACTED_OPENAI_KEY]"'
 * // foundSecrets: ['OPENAI_KEY']
 * ```
 */
export function redactSecrets(content: string): RedactionResult {
  let redacted = content;
  const foundSecrets: string[] = [];

  // Scan with all patterns
  for (const pattern of SECRET_PATTERNS) {
    const matches = content.match(pattern.regex);
    if (matches && matches.length > 0) {
      // Add pattern name to found list (once, even if multiple matches)
      if (!foundSecrets.includes(pattern.name)) {
        foundSecrets.push(pattern.name);
      }

      // Replace all matches with placeholder
      redacted = redacted.replace(pattern.regex, `[REDACTED_${pattern.name}]`);
    }
  }

  return { redacted, foundSecrets };
}

/**
 * Prepares search result chunks for API transmission by redacting secrets.
 *
 * This is the ONLY way chunks should be prepared for external API calls.
 * Redacts each chunk's content and warns on console when secrets are found.
 *
 * CRITICAL: Always call this before building prompts or sending to APIs.
 * Pattern: chunks → prepareChunksForAPI → buildPrompt → API call
 *
 * Edge cases:
 * - No secrets: Returns chunks unchanged
 * - Multiple secrets in one chunk: Redacts all, warns once per chunk
 * - Empty chunks: Returns unchanged
 *
 * @param chunks - Array of search results from hybrid search
 * @returns New array with redacted chunk content
 *
 * @example
 * ```typescript
 * const chunks = await hybridSearch(...);
 * const safeChunks = prepareChunksForAPI(chunks);
 * const prompt = buildRAGPrompt(query, safeChunks); // Safe to send to API
 * ```
 */
export function prepareChunksForAPI(chunks: SearchResult[]): SearchResult[] {
  return chunks.map((chunk) => {
    const { redacted, foundSecrets } = redactSecrets(chunk.content);

    // Warn user when secrets are redacted (transparency)
    if (foundSecrets.length > 0) {
      console.warn(`Redacted ${foundSecrets.join(', ')} in ${chunk.filePath}:${chunk.startLine}`);
    }

    // Return new chunk with redacted content
    return {
      ...chunk,
      content: redacted,
    };
  });
}
