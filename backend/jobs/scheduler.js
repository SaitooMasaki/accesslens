import cron from 'node-cron';
import PQueue from 'p-queue';
import { pool } from '../db/pool.js';
import { scanUrl } from '../services/scanner.js';
import { sendWeeklyDigest } from '../services/mailer.js';
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

/**
 * Agency プランの全ユーザーに週次ダイジェストメールを送信する。
 * 各ユーザーについて直近7日と前の7日のスキャン結果を比較して差分を送る。
 * 1ユーザーの失敗が他に影響しないよう try/catch を各ユーザーに設ける。
 */
async function runWeeklyDigest() {
  let users;
  try {
    const { rows } = await pool.query(
      `SELECT id, email FROM users
       WHERE plan = 'agency'
         AND email_digest_enabled = true
         AND (subscription_status IS NULL
              OR subscription_status NOT IN ('cancelled', 'expired'))`,
    );
    users = rows;
  } catch (err) {
    logger.error({ err }, 'Failed to fetch users for weekly digest');
    return;
  }

  if (!users.length) {
    logger.info('No users to send weekly digest');
    return;
  }

  logger.info({ count: users.length }, 'Weekly digest batch started');

  for (const user of users) {
    try {
      // ユーザーのサイトと直近2週間のスキャン結果を取得
      const { rows: sites } = await pool.query(
        `SELECT
           s.id, s.url, s.label,
           (SELECT violations_count FROM scans
            WHERE site_id = s.id AND scanned_at >= NOW() - INTERVAL '7 days'
            ORDER BY scanned_at DESC LIMIT 1) AS current_violations,
           (SELECT violations_count FROM scans
            WHERE site_id = s.id
              AND scanned_at >= NOW() - INTERVAL '14 days'
              AND scanned_at <  NOW() - INTERVAL '7 days'
            ORDER BY scanned_at DESC LIMIT 1) AS previous_violations
         FROM sites s
         WHERE s.user_id = $1 AND s.deleted_at IS NULL`,
        [user.id],
      );

      if (!sites.length) continue;

      await sendWeeklyDigest(user, sites.map((s) => ({
        url: s.url,
        label: s.label,
        currentViolations: s.current_violations,
        previousViolations: s.previous_violations,
      })));
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Weekly digest failed for user');
    }
  }
}

export function startScheduler() {
  // daily 設定サイト: 毎日 AM 3:00 UTC
  cron.schedule('0 3 * * *', () => runScheduledScans('daily'), { timezone: 'UTC' });

  // weekly 設定サイト: 毎週月曜 AM 3:00 UTC
  cron.schedule('0 3 * * 1', () => runScheduledScans('weekly'), { timezone: 'UTC' });

  // 週次メールダイジェスト: 毎週月曜 AM 9:00 UTC
  cron.schedule('0 9 * * 1', () => runWeeklyDigest(), { timezone: 'UTC' });

  logger.info('Scheduler started (scans=03:00 UTC, digest=Mon 09:00 UTC)');
}
