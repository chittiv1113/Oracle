import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('CLI smoke tests', () => {
  it('should display help', () => {
    const output = execSync('node dist/cli/index.js --help', { encoding: 'utf-8' });
    expect(output).toContain('repoqa');
    expect(output).toContain('ask');
    expect(output).toContain('index');
    expect(output).toContain('update');
    expect(output).toContain('config');
  });

  it('should display version', () => {
    const output = execSync('node dist/cli/index.js --version', { encoding: 'utf-8' });
    expect(output).toMatch(/\d+\.\d+\.\d+/);
  });

  it('each subcommand displays help without crashing', () => {
    const subcommands = ['ask', 'index', 'update', 'config'];
    for (const cmd of subcommands) {
      expect(() => {
        execSync(`node dist/cli/index.js ${cmd} --help`, { encoding: 'utf-8' });
      }).not.toThrow();
    }
  });
});
