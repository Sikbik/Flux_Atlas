import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { atlasBuilder } from '../services/atlasBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const createServer = () => {
  const app = express();

  // Enable gzip/brotli compression for all responses
  // This significantly reduces payload size (70-80% reduction for JSON)
  app.use(compression({
    level: 6, // Balanced compression level (1-9)
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
      // Compress JSON and static assets
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    }
  }));

  // Security headers with Content Security Policy
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Required for styled components
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "https://api.runonflux.io"],
        workerSrc: ["'self'", "blob:"], // For Three.js/WebGL workers
        childSrc: ["'self'", "blob:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    }
  }));

  // Rate limiting: 100 requests per minute per IP
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // SECURITY: Configure CORS properly for production
  const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
      ? process.env.ALLOWED_ORIGINS?.split(',') || false // Set ALLOWED_ORIGINS in production .env
      : true, // Allow all origins in development
    methods: ['GET', 'HEAD'],
    credentials: false,
    optionsSuccessStatus: 204
  };
  app.use(cors(corsOptions));

  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (req, res) => {
    // SECURITY: Only expose detailed metrics to internal/local IPs
    const clientIp = req.ip || req.socket.remoteAddress || '';
    const isInternal =
      clientIp.startsWith('127.') ||
      clientIp.startsWith('::1') ||
      clientIp.startsWith('::ffff:127.') ||
      clientIp === '::1';

    const state = atlasBuilder.getState();

    // External callers only get basic status
    if (!isInternal) {
      if (state.error) {
        res.status(503).json({ status: 'error' });
      } else if (state.building) {
        res.status(202).json({ status: 'starting' });
      } else {
        res.json({ status: 'ok' });
      }
      return;
    }

    // Internal callers get detailed metrics
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

  // Lightweight endpoint for polling - only returns build status, no graph data
  app.get('/api/status', (_req, res) => {
    const state = atlasBuilder.getState();
    const progress = atlasBuilder.getProgress();
    res.json({
      building: state.building,
      buildId: state.data?.buildId,
      error: state.error,
      progress: state.building ? progress : null,
    });
  });

  // Serve static frontend files (for production)
  const frontendPath = path.join(__dirname, '../../../frontend/dist');
  app.use(express.static(frontendPath));

  // SPA fallback - serve index.html for any non-API routes
  app.use((_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  return app;
};
