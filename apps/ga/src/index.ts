import { logger } from './logger.js';
import { GARunner } from './genetic/runner.js';

const main = async () => {
  const runner = new GARunner();
  await runner.run();
};

main().catch((error) => {
  logger.error({ err: error }, 'GA runner failed');
  process.exitCode = 1;
});
