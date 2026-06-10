/**
 * Phase 2-2: Puppeteer + axe-core によるサーバーサイドスキャン。
 * このファイルは Phase 2-1 でインターフェースだけを定義する。
 * 実際の実装は Issue #3 (Phase 2-2) で行う。
 */
import { logger } from '../logger.js';

/**
 * 指定 URL をサーバーサイドでスキャンし、axe-core の結果を返す。
 * @param {string} url
 * @returns {Promise<{ violationsCount: number, criticalCount: number, seriousCount: number, resultJson: object }>}
 */
export async function scanUrl(url) {
  // TODO: Phase 2-2 で実装
  // puppeteer でページを開き、axe-core を注入してスキャン結果を取得する
  logger.warn({ url }, 'scanUrl: Phase 2-2 未実装');
  throw new Error('Server-side scan not yet implemented (Phase 2-2)');
}
