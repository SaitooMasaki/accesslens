import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * POST /api/webhook/lemonsqueezy
 *
 * 注意: server.js 側で express.raw({ type: 'application/json' }) を適用済み。
 *       署名検証に生 body が必要なため、このルートでは express.json() を使わない。
 *
 * Lemon Squeezy ダッシュボードで登録するイベント:
 *   subscription_created / subscription_updated /
 *   subscription_cancelled / subscription_expired
 */
router.post('/lemonsqueezy', async (req, res) => {
  // --- 1. 署名検証（最優先。失敗は即 401） ---
  const signature = req.headers['x-signature'];
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('LEMONSQUEEZY_WEBHOOK_SECRET is not set — skipping signature verification');
  } else if (!signature) {
    logger.warn('Webhook request missing X-Signature header');
    return res.status(401).json({ error: 'Missing signature' });
  } else {
    const digest = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('hex');
    if (digest !== signature) {
      logger.warn({ signature }, 'Webhook signature mismatch');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // --- 2. ペイロードのパース ---
  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventName = payload?.meta?.event_name;
  const attrs = payload?.data?.attributes ?? {};

  logger.info({ eventName }, 'Webhook received');

  // --- 3. ユーザー特定 ---
  // チェックアウト時に meta.custom_data.user_id を埋め込んでいればそれを優先し、
  // なければ customer の email でフォールバックする。
  const customUserId = payload?.meta?.custom_data?.user_id ?? null;
  const customerEmail = attrs.user_email ?? null;

  let user = null;
  try {
    if (customUserId) {
      const { rows } = await pool.query('SELECT id, email FROM users WHERE id = $1', [customUserId]);
      user = rows[0] ?? null;
    }
    if (!user && customerEmail) {
      const { rows } = await pool.query('SELECT id, email FROM users WHERE email = $1', [customerEmail]);
      user = rows[0] ?? null;
    }
  } catch (err) {
    logger.error({ err }, 'Failed to look up user for webhook');
  }

  if (!user) {
    // ユーザーが見つからなくてもクラッシュしない。Lemon Squeezy にはリトライさせない（200を返す）。
    logger.warn({ eventName, customUserId, customerEmail }, 'Webhook: user not found, ignoring');
    return res.status(200).json({ received: true });
  }

  // --- 4. イベント処理 ---
  try {
    await handleEvent(eventName, user.id, attrs);
  } catch (err) {
    logger.error({ err, eventName, userId: user.id }, 'Webhook event handling failed');
    // Lemon Squeezy のリトライを防ぐため、処理失敗でも 200 を返す
  }

  res.status(200).json({ received: true });
});

async function handleEvent(eventName, userId, attrs) {
  switch (eventName) {
    case 'subscription_created':
      await pool.query(
        `UPDATE users
         SET plan                  = 'agency',
             lemon_subscription_id = $1,
             subscription_status   = $2,
             updated_at            = NOW()
         WHERE id = $3`,
        [String(attrs.id ?? ''), attrs.status ?? 'active', userId],
      );
      logger.info({ userId }, 'subscription_created: plan set to agency');
      break;

    case 'subscription_updated':
      await pool.query(
        `UPDATE users
         SET subscription_status = $1,
             updated_at          = NOW()
         WHERE id = $2`,
        [attrs.status ?? null, userId],
      );
      logger.info({ userId, status: attrs.status }, 'subscription_updated');
      break;

    case 'subscription_cancelled':
      await pool.query(
        `UPDATE users
         SET subscription_status = 'cancelled',
             updated_at          = NOW()
         WHERE id = $1`,
        [userId],
      );
      logger.info({ userId }, 'subscription_cancelled');
      break;

    case 'subscription_expired':
      // plan を free に戻す。
      // スケジューラーは plan='agency' かつ subscription_status が有効なユーザーのみ
      // スキャンを実行するため、DB 更新だけで定期スキャンが自動停止する。
      await pool.query(
        `UPDATE users
         SET plan                = 'free',
             subscription_status = 'expired',
             updated_at          = NOW()
         WHERE id = $1`,
        [userId],
      );
      logger.info({ userId }, 'subscription_expired: plan reverted to free, scheduled scans stopped');
      break;

    default:
      logger.info({ eventName, userId }, 'Webhook: unhandled event (ignored)');
  }
}

export default router;
