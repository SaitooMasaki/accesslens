/**
 * Phase 2-4: 拡張機能 ↔ バックエンド クラウド同期。
 * このファイルは Phase 2-1 でルートのスタブだけを用意する。
 * 実際の実装は Issue #5 (Phase 2-4) で行う。
 */
import { Router } from 'express';
import { requireAuth, requirePlan } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();
router.use(requireAuth);
router.use(requirePlan('agency'));

/**
 * PATCH /api/sync
 * 拡張機能から変更差分を受け取りサーバーに反映し、
 * サーバー側の差分を返す（last-write-wins）。
 */
router.patch('/', (_req, res) => {
  // TODO: Phase 2-4 で実装
  logger.warn('PATCH /api/sync: Phase 2-4 未実装');
  res.status(501).json({ error: 'Cloud sync not yet implemented (Phase 2-4)' });
});

export default router;
