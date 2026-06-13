import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { pool } from '../db/pool.js';
import { requireAuth, requirePlan } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();
router.use(requireAuth);
router.use(requirePlan('agency'));

/**
 * PATCH /api/sync
 * 拡張機能からの変更差分をサーバーに反映し、
 * サーバー側の新しい変更を返す（last-write-wins）。
 *
 * Request body:
 *   clients:  Array<Record>  — syncStatus='pending' のクライアント一覧
 *   projects: Array<Record>  — syncStatus='pending' のプロジェクト一覧
 *   since:    number         — 前回同期時の ms タイムスタンプ（サーバー変更の取得基準）
 *
 * Response:
 *   clients:  Array<Record>  — since 以降にサーバーで更新されたレコード
 *   projects: Array<Record>
 */
router.patch(
  '/',
  body('clients').optional().isArray(),
  body('projects').optional().isArray(),
  body('since').optional().isNumeric(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { clients = [], projects = [], since = 0 } = req.body;
    const userId = req.user.userId;
    const sinceDate = new Date(Number(since));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // クライアントから受け取った変更を処理する（last-write-wins）
      await upsertCollection(client, userId, 'clients', clients);
      await upsertCollection(client, userId, 'projects', projects);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, userId }, 'Sync transaction failed');
      return res.status(500).json({ error: 'Sync failed' });
    } finally {
      client.release();
    }

    // since 以降にサーバーで更新されたレコードを返す
    const [{ rows: serverClients }, { rows: serverProjects }] = await Promise.all([
      pool.query(
        `SELECT data FROM sync_records
         WHERE user_id = $1 AND collection = 'clients' AND updated_at > $2`,
        [userId, sinceDate],
      ),
      pool.query(
        `SELECT data FROM sync_records
         WHERE user_id = $1 AND collection = 'projects' AND updated_at > $2`,
        [userId, sinceDate],
      ),
    ]);

    res.json({
      clients: serverClients.map((r) => r.data),
      projects: serverProjects.map((r) => r.data),
    });
  },
);

/**
 * 1コレクション分のレコードを last-write-wins で upsert する。
 * クライアントの updatedAt がサーバーより新しい場合のみ上書きする。
 */
async function upsertCollection(client, userId, collection, records) {
  for (const record of records) {
    if (!record.id || record.updatedAt == null) continue;

    const clientUpdatedAt = new Date(Number(record.updatedAt));
    const deletedAt = record.deletedAt ? new Date(Number(record.deletedAt)) : null;

    await client.query(
      `INSERT INTO sync_records (id, user_id, collection, data, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id, user_id, collection) DO UPDATE
         SET data       = EXCLUDED.data,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at
         WHERE sync_records.updated_at < EXCLUDED.updated_at`,
      [record.id, userId, collection, JSON.stringify(record), clientUpdatedAt, deletedAt],
    );
  }
}

export default router;
