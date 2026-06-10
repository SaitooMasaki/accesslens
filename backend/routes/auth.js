import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { validateLicenseKey } from '../services/lemonsqueezy.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * POST /api/auth/login
 * ライセンスキーを Lemon Squeezy で検証し、JWT を発行する。
 * ユーザーが存在しなければ自動作成（upsert）。
 */
router.post(
  '/login',
  body('licenseKey').isString().trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { licenseKey } = req.body;

    let lsUser;
    try {
      lsUser = await validateLicenseKey(licenseKey);
    } catch (err) {
      logger.error({ err }, 'License validation error');
      return res.status(503).json({ error: 'License verification service unavailable' });
    }

    if (!lsUser) {
      return res.status(401).json({ error: 'Invalid or inactive license key' });
    }

    if (!lsUser.email) {
      return res.status(401).json({ error: 'Could not retrieve account email from license' });
    }

    // ユーザーを upsert（プランや Lemon Squeezy 情報を常に最新にする）
    const { rows } = await pool.query(
      `INSERT INTO users (email, plan, lemon_customer_id, lemon_subscription_id, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (email) DO UPDATE
         SET plan                  = EXCLUDED.plan,
             lemon_customer_id     = EXCLUDED.lemon_customer_id,
             lemon_subscription_id = EXCLUDED.lemon_subscription_id,
             updated_at            = NOW()
       RETURNING id, email, plan`,
      [lsUser.email, lsUser.plan, lsUser.customerId, lsUser.orderId],
    );

    const user = rows[0];
    logger.info({ userId: user.id, plan: user.plan }, 'User logged in');

    const token = jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '30d' },
    );

    return res.json({ token, user: { id: user.id, email: user.email, plan: user.plan } });
  },
);

export default router;
