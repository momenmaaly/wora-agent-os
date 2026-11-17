import express from 'express';
import { bootWoraServer } from './wora-server.js';
import { logger } from './lib/logger.js';

const port = Number(process.env['PORT'] ?? 4000);
const app  = express();

bootWoraServer(app, port).catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to boot Wora server');
  process.exit(1);
});
