import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * GET /api/unsubscribe?token=xxx
 * メール内のリンクから叩かれる。認証不要。
 * JWT を検証してメールダイジェストを無効化し、確認ページを返す。
 */
router.get('/', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send(page('Invalid link', 'The unsubscribe link is missing or invalid.'));

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(400).send(page('Link expired', 'This unsubscribe link has expired. Please contact support.'));
  }

  if (payload.purpose !== 'unsubscribe') {
    return res.status(400).send(page('Invalid link', 'This link cannot be used for unsubscribing.'));
  }

  const { rowCount } = await pool.query(
    `UPDATE users SET email_digest_enabled = false, updated_at = NOW()
     WHERE id = $1 AND email_digest_enabled = true`,
    [payload.userId],
  );

  if (rowCount) {
    logger.info({ userId: payload.userId }, 'User unsubscribed from weekly digest');
  }

  res.send(page(
    'Unsubscribed',
    'You have been unsubscribed from AccessLens weekly reports. You will no longer receive these emails.',
  ));
});

function page(title, message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>AccessLens — ${title}</title>
<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#F9FAFB;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.card{background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:48px;max-width:480px;text-align:center;}
h1{font-size:20px;color:#1F2937;margin:0 0 12px;}p{color:#6B7280;font-size:15px;margin:0;}
.logo{font-size:16px;font-weight:700;color:#2563EB;margin-bottom:24px;}</style>
</head><body><div class="card"><div class="logo">AccessLens</div>
<h1>${title}</h1><p>${message}</p></div></body></html>`;
}

export default router;
