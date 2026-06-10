import { Router } from 'express';
import { query, param, validationResult } from 'express-validator';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/scans?siteId=uuid&limit=50&offset=0
 * 指定サイトのスキャン履歴を新しい順に返す。
 * siteId はログインユーザーが所有するサイトに限定する（他ユーザーの閲覧を防ぐ）。
 */
router.get(
  '/',
  query('siteId').isUUID(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { siteId, limit = 50, offset = 0 } = req.query;

    // サイトの所有者確認
    const { rowCount } = await pool.query(
      `SELECT 1 FROM sites WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [siteId, req.user.userId],
    );
    if (!rowCount) return res.status(404).json({ error: 'Site not found' });

    const { rows } = await pool.query(
      `SELECT id, triggered_by, violations_count, critical_count, serious_count, scanned_at
       FROM scans
       WHERE site_id = $1
       ORDER BY scanned_at DESC
       LIMIT $2 OFFSET $3`,
      [siteId, limit, offset],
    );
    res.json(rows);
  },
);

/** GET /api/scans/:id — スキャン詳細（result_json を含む） */
router.get('/:id', param('id').isUUID(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { rows } = await pool.query(
    `SELECT s.*
     FROM scans s
     JOIN sites si ON si.id = s.site_id
     WHERE s.id = $1 AND si.user_id = $2`,
    [req.params.id, req.user.userId],
  );
  if (!rows.length) return res.status(404).json({ error: 'Scan not found' });
  res.json(rows[0]);
});

export default router;
