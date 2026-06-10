import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { logger } from './logger.js';
import { applySchema } from './db/pool.js';
import { startScheduler } from './jobs/scheduler.js';
import authRouter from './routes/auth.js';
import sitesRouter from './routes/sites.js';
import scansRouter from './routes/scans.js';
import webhookRouter from './routes/webhook.js';
import syncRouter from './services/sync.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));

// Webhook は署名検証に生 body が必要なので express.json() より前にマウント
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRouter);

app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/sites', sitesRouter);
app.use('/api/scans', scansRouter);
app.use('/api/sync', syncRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// 未定義ルート
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// グローバルエラーハンドラー
app.use((err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT ?? 3000);

async function start() {
  await applySchema();
  startScheduler();
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'AccessLens backend started');
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
