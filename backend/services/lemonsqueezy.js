import { logger } from '../logger.js';

const LS_BASE = 'https://api.lemonsqueezy.com/v1';

// Phase 1 の licensing/lemonsqueezy.js の VARIANT_PLAN_MAP と同期させること
const VARIANT_PLAN_MAP = {
  1762636: 'pro',
  1787048: 'agency',
};

/**
 * Lemon Squeezy のライセンスキーをサーバー側で検証する。
 * 有効であればユーザー情報とプランを返す。無効な場合は null を返す。
 */
export async function validateLicenseKey(licenseKey) {
  let res;
  try {
    res = await fetch(`${LS_BASE}/licenses/validate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
      },
      body: JSON.stringify({ license_key: licenseKey }),
    });
  } catch (err) {
    logger.error({ err }, 'LS API request failed');
    throw new Error('License verification service unavailable');
  }

  const data = await res.json();

  if (!res.ok || !data.valid) {
    logger.warn({ status: res.status, error: data.error }, 'LS license invalid');
    return null;
  }

  const variantId = data.meta?.variant_id;
  const plan = VARIANT_PLAN_MAP[variantId] ?? 'free';

  return {
    email: data.meta?.customer_email ?? null,
    customerId: data.meta?.customer_id ? String(data.meta.customer_id) : null,
    orderId: data.meta?.order_id ? String(data.meta.order_id) : null,
    plan,
  };
}
