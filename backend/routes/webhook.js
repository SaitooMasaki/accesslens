/**
 * Phase 2-5: Lemon Squeezy Webhook エンドポイント。
 * このファイルは Phase 2-1 でルーティングの骨格だけを用意する。
 * 実際の処理は Issue #6 (Phase 2-5) で実装する。
 *
 * 注意: express.raw({ type: 'application/json' }) で生 body を受け取るため、
 *       server.js 側で /api/webhook には express.json() を適用しないこと。
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../logger.js';

const router = Router();

router.post('/lemonsqueezy', (req, res) => {
  // 署名検証（Phase 2-5 で実装するまでは 200 だけ返してリトライを防ぐ）
  const signature = req.headers['x-signature'];
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

  if (secret && signature) {
    const digest = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('hex');

    if (digest !== signature) {
      logger.warn('Webhook signature mismatch');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  logger.info({ eventName: payload?.meta?.event_name }, 'Webhook received (Phase 2-5 未実装)');

  // Phase 2-5 で各イベントの処理を実装する
  // subscription_created / subscription_updated / subscription_cancelled / subscription_expired

  res.status(200).json({ received: true });
});

export default router;
