import { config } from './config/env.js';
import { createServer } from './http/server.js';
import { atlasBuilder } from './services/atlasBuilder.js';
import { logger } from './utils/logger.js';

const app = createServer();

atlasBuilder.start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('Atlas builder failed during startup', { message });
});

app.listen(config.port, () => {
  logger.info('Flux Atlas backend listening', { port: config.port });
});
