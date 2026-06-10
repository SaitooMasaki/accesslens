import { Router } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { pool } from '../db/pool.js';
import { requireAuth, requirePlan } from '../middleware/auth.js';
import { scanUrl } from '../services/scanner.js';
import { logger } from '../logger.js';

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

/**
 * POST /api/scans — サーバーサイドで手動スキャンを実行する（Agency プランのみ）。
 * cron を待たずにスキャンをテストするためにも使用する。
 */
router.post(
  '/',
  requirePlan('agency'),
  body('siteId').isUUID(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { siteId } = req.body;
    const { rows: siteRows } = await pool.query(
      `SELECT id, url FROM sites WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [siteId, req.user.userId],
    );
    if (!siteRows.length) return res.status(404).json({ error: 'Site not found' });

    const site = siteRows[0];
    let result;
    try {
      result = await scanUrl(site.url);
    } catch (err) {
      logger.error({ err, siteId, url: site.url }, 'Manual scan failed');
      return res.status(502).json({ error: 'Scan failed', detail: err.message });
    }

    const { rows } = await pool.query(
      `INSERT INTO scans
         (site_id, triggered_by, violations_count, critical_count, serious_count, result_json)
       VALUES ($1, 'manual', $2, $3, $4, $5)
       RETURNING *`,
      [siteId, result.violationsCount, result.criticalCount, result.seriousCount, JSON.stringify(result.resultJson)],
    );
    logger.info({ siteId, url: site.url, violations: result.violationsCount }, 'Manual scan saved');
    res.status(201).json(rows[0]);
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
