import { Command } from 'commander';
import { askCommand } from './commands/ask.js';
import { indexCommand } from './commands/index.js';
import { updateCommand } from './commands/update.js';
import { configCommand } from './commands/config.js';

export const program = new Command()
  .name('oracle')
  .description('AI-powered repository Q&A')
  .version('0.0.1');

program.addCommand(indexCommand);
program.addCommand(askCommand);
program.addCommand(updateCommand);
program.addCommand(configCommand);
