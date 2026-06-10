import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();
router.use(requireAuth);

/** GET /api/sites — ログインユーザーの監視サイト一覧（論理削除済みを除く） */
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, client_id, url, label, scan_interval, created_at, updated_at
     FROM sites
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [req.user.userId],
  );
  res.json(rows);
});

/** POST /api/sites — 新規サイト登録 */
router.post(
  '/',
  body('url').isURL({ require_protocol: true }),
  body('label').optional().isString().trim().isLength({ max: 200 }),
  body('client_id').optional().isUUID(),
  body('scan_interval').optional().isIn(['daily', 'weekly']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { url, label, client_id, scan_interval = 'weekly' } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO sites (user_id, url, label, client_id, scan_interval)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.userId, url, label ?? null, client_id ?? null, scan_interval],
    );
    logger.info({ siteId: rows[0].id, url }, 'Site created');
    res.status(201).json(rows[0]);
  },
);

/** PUT /api/sites/:id — サイト情報の更新 */
router.put(
  '/:id',
  param('id').isUUID(),
  body('url').optional().isURL({ require_protocol: true }),
  body('label').optional().isString().trim().isLength({ max: 200 }),
  body('scan_interval').optional().isIn(['daily', 'weekly']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { url, label, scan_interval } = req.body;
    const { rows } = await pool.query(
      `UPDATE sites
       SET url           = COALESCE($1, url),
           label         = COALESCE($2, label),
           scan_interval = COALESCE($3, scan_interval),
           updated_at    = NOW()
       WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL
       RETURNING *`,
      [url ?? null, label ?? null, scan_interval ?? null, req.params.id, req.user.userId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Site not found' });
    res.json(rows[0]);
  },
);

/** DELETE /api/sites/:id — 論理削除 */
router.delete('/:id', param('id').isUUID(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { rowCount } = await pool.query(
    `UPDATE sites SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [req.params.id, req.user.userId],
  );
  if (!rowCount) return res.status(404).json({ error: 'Site not found' });
  logger.info({ siteId: req.params.id }, 'Site deleted');
  res.status(204).end();
});

export default router;
