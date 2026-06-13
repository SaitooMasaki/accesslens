import { Resend } from 'resend';
import jwt from 'jsonwebtoken';
import { logger } from '../logger.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.FROM_EMAIL ?? 'AccessLens <noreply@accesslens.dev>';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/** 最大 maxRetries 回リトライするラッパー */
async function withRetry(fn, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      logger.warn({ err, attempt: i + 1, maxRetries }, 'Retrying after error');
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** 配信停止リンク用の署名付きトークンを生成する */
function buildUnsubscribeUrl(userId) {
  const token = jwt.sign(
    { userId, purpose: 'unsubscribe' },
    process.env.JWT_SECRET,
    { expiresIn: '90d' },
  );
  return `${APP_URL}/api/unsubscribe?token=${token}`;
}

/**
 * 各サイトの違反数サマリー行を組み立てる。
 * @param {{ url: string, label: string|null, currentViolations: number|null, previousViolations: number|null }[]} sites
 */
function buildSiteRows(sites) {
  return sites.map((s) => {
    const label = s.label || s.url;
    if (s.currentViolations === null) {
      return { label, badge: '⚪', delta: 'No scan this week', deltaNum: 0 };
    }
    if (s.previousViolations === null) {
      return { label, badge: '🔵', delta: `${s.currentViolations} violations (no previous data)`, deltaNum: 0 };
    }
    const diff = s.currentViolations - s.previousViolations;
    if (diff > 0)  return { label, badge: '🔴', delta: `+${diff} violations`, deltaNum: diff };
    if (diff < 0)  return { label, badge: '🟢', delta: `${diff} violations`, deltaNum: diff };
    return { label, badge: '🟢', delta: 'No change ✓', deltaNum: 0 };
  });
}

function buildHtml(rows, unsubscribeUrl) {
  const attention = rows.filter((r) => r.deltaNum > 0).length;
  const subject = attention > 0
    ? `[AccessLens] Weekly Report — ${attention} site${attention > 1 ? 's' : ''} need attention`
    : '[AccessLens] Weekly Report — All sites look good';

  const rowsHtml = rows.map((r) => `
    <tr>
      <td style="padding:8px 0; font-size:14px;">${r.badge}&nbsp;<strong>${r.label}</strong></td>
      <td style="padding:8px 0; font-size:14px; color:#6B7280;">${r.delta}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB;">
    <div style="background:#2563EB;padding:24px 32px;">
      <span style="color:#fff;font-size:18px;font-weight:700;">AccessLens</span>
      <span style="color:#BFDBFE;font-size:13px;margin-left:12px;">Weekly Report</span>
    </div>
    <div style="padding:32px;">
      <p style="color:#1F2937;font-size:15px;margin:0 0 24px;">Here's your weekly accessibility summary.</p>
      <table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
      <div style="margin-top:32px;">
        <a href="${APP_URL}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;">View full reports →</a>
      </div>
    </div>
    <div style="padding:16px 32px;background:#F9FAFB;border-top:1px solid #E5E7EB;font-size:12px;color:#9CA3AF;">
      AccessLens &nbsp;·&nbsp;
      <a href="${unsubscribeUrl}" style="color:#9CA3AF;">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

/**
 * 週次ダイジェストメールを1ユーザーに送信する。
 * 違反ゼロ＆変動なしのサイトのみの場合は送信しない。
 */
export async function sendWeeklyDigest(user, sites) {
  const rows = buildSiteRows(sites);

  // 全サイトが「変動なし」かつ「違反ゼロ」なら送信スキップ
  const hasContent = rows.some((r) => r.deltaNum !== 0 || r.label);
  const allNoChange = rows.every((r) => r.deltaNum === 0 && r.label);
  const allZero = sites.every((s) => s.currentViolations === 0);
  if (allNoChange && allZero) {
    logger.info({ userId: user.id }, 'Digest skipped: no violations and no changes');
    return;
  }

  const unsubscribeUrl = buildUnsubscribeUrl(user.id);
  const { subject, html } = buildHtml(rows, unsubscribeUrl);

  await withRetry(async () => {
    const { error } = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject,
      html,
    });
    if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
  });

  logger.info({ userId: user.id, email: user.email }, 'Weekly digest sent');
}
