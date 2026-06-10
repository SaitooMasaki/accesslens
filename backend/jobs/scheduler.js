/**
 * Phase 2-3: 定期自動スキャンの cron ジョブ。
 * このファイルは Phase 2-1 でスタブだけを用意する。
 * 実際の実装は Issue #3 (Phase 2-3) で行う。
 */
import { logger } from '../logger.js';

/**
 * スケジューラーを起動する。
 * server.js の start() から呼び出す。
 */
export function startScheduler() {
  // TODO: Phase 2-3 で node-cron を使って実装
  // - daily 設定サイト: 毎日 AM 3:00 UTC
  // - weekly 設定サイト: 毎週月曜 AM 3:00 UTC
  // - p-queue で順次処理（同時実行数を制限）
  logger.info('Scheduler: Phase 2-3 未実装（スキップ）');
}
