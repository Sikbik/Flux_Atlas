import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { atlasBuilder } from '../services/atlasBuilder.js';

export const createServer = () => {
  const app = express();

  // Security headers
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));

  // Rate limiting: 100 requests per minute per IP
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    const state = atlasBuilder.getState();
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    if (state.error) {
      res.status(503).json({
        status: 'error',
        error: state.error,
        uptime,
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024)
        }
      });
    } else if (state.building) {
      res.status(202).json({
        status: 'starting',
        uptime,
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024)
        }
      });
    } else {
      res.json({
        status: 'ok',
        uptime,
        nodes: state.data?.stats.totalNodes || 0,
        edges: state.data?.stats.totalEdgesTrimmed || 0,
        lastBuild: state.data?.completedAt,
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024)
        }
      });
    }
  });

  app.get('/api/state', (_req, res) => {
    res.json(atlasBuilder.getState());
  });

  return app;
};
