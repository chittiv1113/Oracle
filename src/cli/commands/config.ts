import { Command } from 'commander';
import { input, select, confirm } from '@inquirer/prompts';
import { writeFile } from 'fs/promises';
import isCI from 'is-ci';
import chalk from 'chalk';

/**
 * Run interactive configuration wizard.
 *
 * Used by:
 * - config command (manual configuration)
 * - ask command (auto-trigger on first run if no provider configured)
 */
export async function runConfigWizard(forceInteractive = false): Promise<void> {
  // Graceful degradation for CI environments (critical - prevents hangs)
  // Skip check if --force flag is used (for PowerShell users)
  if (isCI && !forceInteractive) {
    console.log(chalk.yellow('⚠️  Running in CI environment.'));
    console.log(chalk.dim('Tip: Use --force to run wizard anyway\n'));
    console.log('Set environment variables instead:');
    console.log('  - ANTHROPIC_API_KEY (for Claude models)');
    console.log('  - OPENAI_API_KEY (for GPT models)');
    console.log('  - OLLAMA_HOST (for local Ollama)');
    console.log('  - COHERE_API_KEY (optional for better reranking)');
    console.log('\nOr create .oraclerc file manually:');
    console.log(
      '  { "llm": { "provider": "anthropic" }, "anthropic": { "apiKey": "sk-ant-..." } }',
    );
    process.exit(0);
  }

  // Show friendly message if forcing in CI
  if (isCI && forceInteractive) {
    console.log(chalk.blue('ℹ️  CI detected, but running wizard anyway (--force)\n'));
  }

  console.log(chalk.blue('🔧 Welcome to Oracle configuration wizard!\n'));

  // Step 1: Provider selection
  const provider = await select({
    message: 'Select LLM provider:',
    choices: [
      { name: 'Anthropic Claude (recommended)', value: 'anthropic' },
      { name: 'OpenAI GPT-4o', value: 'openai' },
      { name: 'Ollama (local, free)', value: 'ollama' },
    ],
    default: 'anthropic',
  });

  // Step 2: Provider-specific configuration
  let providerConfig: Record<string, unknown> = {};

  if (provider === 'anthropic') {
    // Anthropic API key with validation
    const anthropicKey = await input({
      message: 'Anthropic API key:',
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return 'API key cannot be empty';
        if (!trimmed.startsWith('sk-ant-')) {
          return 'Anthropic API keys start with sk-ant-';
        }
        if (trimmed.length < 20) {
          return 'API key seems too short';
        }
        return true;
      },
    });

    // Model selection
    const model = await select({
      message: 'Select Claude model:',
      choices: [
        {
          name: 'Claude Sonnet 4.5 (recommended - balanced speed/quality)',
          value: 'claude-sonnet-4-5-20250929',
          description: 'Best balance of performance and quality',
        },
        {
          name: 'Claude Opus 4.6 (best quality, slower)',
          value: 'claude-opus-4-6',
          description: 'Highest quality answers, higher cost',
        },
        {
          name: 'Claude Haiku 4.5 (fastest, lower quality)',
          value: 'claude-haiku-4-5-20250929',
          description: 'Fast responses, good for simple questions',
        },
      ],
      default: 'claude-sonnet-4-5-20250929',
    });

    providerConfig = {
      anthropic: {
        apiKey: anthropicKey.trim(),
        model,
      },
    };
  } else if (provider === 'openai') {
    // OpenAI API key with validation
    const openaiKey = await input({
      message: 'OpenAI API key:',
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return 'API key cannot be empty';
        if (!trimmed.startsWith('sk-')) {
          return 'OpenAI API keys start with sk-';
        }
        if (trimmed.length < 20) {
          return 'API key seems too short';
        }
        return true;
      },
    });

    // Model selection
    const model = await select({
      message: 'Select OpenAI model:',
      choices: [
        {
          name: 'GPT-4o (recommended - balanced speed/quality)',
          value: 'gpt-4o',
          description: 'Best balance of performance and quality',
        },
        {
          name: 'GPT-4o-mini (faster, lower cost)',
          value: 'gpt-4o-mini',
          description: 'Good for simple questions',
        },
        {
          name: 'o1 (reasoning - slower, best for complex questions)',
          value: 'o1',
          description: 'Deep reasoning, higher cost',
        },
      ],
      default: 'gpt-4o',
    });

    providerConfig = {
      openai: {
        apiKey: openaiKey.trim(),
        model,
      },
    };
  } else if (provider === 'ollama') {
    // Ollama model selection (no API key needed)
    const model = await input({
      message: 'Ollama model name (e.g., llama3.3, qwen2.5-coder):',
      default: 'llama3.3',
      validate: (value) => {
        const trimmed = value.trim();
        if (trimmed.length < 2) {
          return 'Model name must be at least 2 characters';
        }
        return true;
      },
    });

    providerConfig = {
      ollama: {
        model: model.trim(),
      },
    };
  }

  // Step 3: Cohere API key (optional for better reranking)
  const wantsCohere = await confirm({
    message: 'Configure Cohere API key? (optional - improves search quality)',
    default: false,
  });

  let cohereKey: string | undefined;
  if (wantsCohere) {
    cohereKey = await input({
      message: 'Cohere API key (leave empty to skip):',
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return true; // Allow empty to skip
        if (trimmed.length < 20) return 'API key seems too short';
        return true;
      },
    });
  }

  // Step 4: Write config file
  const config = {
    llm: {
      provider,
    },
    ...providerConfig,
    ...(cohereKey && {
      cohere: {
        apiKey: cohereKey.trim(),
      },
    }),
  };

  const configPath = '.oraclerc';
  await writeFile(configPath, JSON.stringify(config, null, 2));

  console.log(chalk.green(`\n✅ Configuration saved to ${configPath}`));
  console.log(chalk.blue(`   Provider: ${provider}`));
  console.log('\nNext steps:');
  console.log(chalk.bold('  1. oracle index') + '  - Index your repository');
  console.log(chalk.bold('  2. oracle ask') + '   - Ask questions about your code');
  console.log('\nTip: Add .oraclerc to .gitignore to keep API keys private.');
}

export const configCommand = new Command('config')
  .description('Configure Oracle settings (API keys, model selection)')
  .option('--force', 'Force interactive mode even in CI environments')
  .addHelpText(
    'after',
    `

Examples:
  # Interactive configuration wizard
  $ oracle config

  # Force interactive mode (PowerShell users)
  $ oracle config --force

  # Alternative: Set environment variables
  $ export ANTHROPIC_API_KEY=sk-ant-...
  $ export OPENAI_API_KEY=sk-...
  $ export OLLAMA_HOST=http://localhost:11434
  $ export COHERE_API_KEY=...

Notes:
  - Creates .oraclerc file in current directory
  - Supports Anthropic, OpenAI, and Ollama providers
  - Environment variables override config file
  - Add .oraclerc to .gitignore to protect API keys
  - Use --force if wizard won't start (PowerShell issue)
`,
  )
  .action(async (options: { force?: boolean }) => {
    await runConfigWizard(options.force || false);
  });
