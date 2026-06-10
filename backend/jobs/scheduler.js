import cron from 'node-cron';
import PQueue from 'p-queue';
import { pool } from '../db/pool.js';
import { scanUrl } from '../services/scanner.js';
import { logger } from '../logger.js';

// 同時実行数1でキューイング（サーバーリソースの過負荷を防ぐ）
const queue = new PQueue({ concurrency: 1 });

/**
 * 指定インターバルの Agency ユーザーのサイトを一括スキャンする。
 * 1サイトの失敗が他に影響しないよう try/catch を各サイトに設ける。
 */
async function runScheduledScans(interval) {
  let sites;
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.url
       FROM sites s
       JOIN users u ON u.id = s.user_id
       WHERE s.scan_interval = $1
         AND s.deleted_at IS NULL
         AND u.plan = 'agency'
         AND (u.subscription_status IS NULL
              OR u.subscription_status NOT IN ('cancelled', 'expired'))`,
      [interval],
    );
    sites = rows;
  } catch (err) {
    logger.error({ err }, 'Failed to fetch sites for scheduled scan');
    return;
  }

  if (!sites.length) {
    logger.info({ interval }, 'No sites to scan');
    return;
  }

  logger.info({ count: sites.length, interval }, 'Scheduled scan batch started');

  for (const site of sites) {
    queue.add(async () => {
      try {
        const result = await scanUrl(site.url);
        await pool.query(
          `INSERT INTO scans
             (site_id, triggered_by, violations_count, critical_count, serious_count, result_json)
           VALUES ($1, 'scheduled', $2, $3, $4, $5)`,
          [site.id, result.violationsCount, result.criticalCount, result.seriousCount, JSON.stringify(result.resultJson)],
        );
        logger.info(
          { siteId: site.id, url: site.url, violations: result.violationsCount },
          'Scheduled scan saved',
        );
      } catch (err) {
        // 1サイトの失敗をログに記録するだけで処理を続行する
        logger.error({ err, siteId: site.id, url: site.url }, 'Scheduled scan failed');
      }
    });
  }
}

export function startScheduler() {
  // daily 設定サイト: 毎日 AM 3:00 UTC
  cron.schedule('0 3 * * *', () => runScheduledScans('daily'), { timezone: 'UTC' });

  // weekly 設定サイト: 毎週月曜 AM 3:00 UTC
  cron.schedule('0 3 * * 1', () => runScheduledScans('weekly'), { timezone: 'UTC' });

  logger.info('Scheduler started (daily=03:00 UTC, weekly=Mon 03:00 UTC)');
}
