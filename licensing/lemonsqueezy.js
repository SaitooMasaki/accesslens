// Lemon Squeezy License API クライアント。
//
// 本番前に必要なLemon Squeezy設定:
// 1. Product/Variant を作成し「Generate license keys」を有効化する
//    - Pro Monthly（例: ¥2,980/mo、通貨はJPYで設定。表記は英語の "/mo" に統一）
//    - Agency Monthly（例: ¥7,480/mo、Phase2機能を含む上位プラン、通貨はJPYで設定）
// 2. サブスクリプション商品としてライセンスキーを発行する設定にする
//    （サブスクが失効するとライセンスキーが disabled/expired になり、
//      validateで権利失効を検知できる）
//
// License API（activate/validate/deactivate）はストアの秘密APIキーを必要としない。
// ライセンスキー単体で叩けるため、バックエンドなしでクライアントから直接呼べる。
//
// client-sideのライセンスゲーティングは技術的にバイパス可能だが、
// ターゲットが「$1,500の監査を顧客に売るB2B制作者」であり、
// 業務ツールを海賊版で使うリスクを取らない層なので許容する（ExtensionPayと同じ前提）。
// 緩和策: 起動時+24hごとの再validate、instance_idの整合チェック。

const LS_BASE = 'https://api.lemonsqueezy.com/v1';
const HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

const STORAGE_KEY = 'al_license';

// チェックアウトURLは事前にLemon Squeezyダッシュボードで発行した固定URLを使う。
// バックレスのため checkout API は叩かない。実URLに差し替えること。
const CHECKOUT_URLS = {
  pro: 'https://saitoomasaki.lemonsqueezy.com/checkout/buy/961b145c-1ee5-4a11-b742-fd7fc5044941',
  // Agency はまだ Phase2機能(定期スキャン/メールダイジェスト/クラウド同期)が
  // 未実装のため、商品自体を未作成 or 非公開のままにしておくこと。
  // 実装が完了し、Lemon Squeezy側で商品を公開したらURLをここに差し替える。
  agency: 'https://accesslens.lemonsqueezy.com/buy/REPLACE_WITH_AGENCY_VARIANT_UUID'
};

// variant_id -> plan のマッピング。実際のVariant IDに差し替えること。
const VARIANT_PLAN_MAP = {
  1762636: 'pro'
  // Agency の Variant ID は商品作成後にここへ追加する
};

async function getStoredLicense() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return (
    data[STORAGE_KEY] || {
      licenseKey: '',
      instanceId: '',
      status: 'inactive',
      plan: 'free',
      lastValidatedAt: 0
    }
  );
}

async function setStoredLicense(license) {
  await chrome.storage.local.set({ [STORAGE_KEY]: license });
  return license;
}

async function clearStoredLicense() {
  const cleared = {
    licenseKey: '',
    instanceId: '',
    status: 'inactive',
    plan: 'free',
    lastValidatedAt: 0
  };
  await setStoredLicense(cleared);
  return cleared;
}

function getInstanceName() {
  // 拡張インストールごとに一意な名前を生成・再利用する。
  return `accesslens-${chrome.runtime.id}`;
}

function planFromMeta(meta) {
  const variantId = meta && meta.variant_id;
  return VARIANT_PLAN_MAP[variantId] || 'pro';
}

async function activateLicense(licenseKey) {
  try {
    const res = await fetch(`${LS_BASE}/licenses/activate`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        license_key: licenseKey,
        instance_name: getInstanceName()
      })
    });
    const data = await res.json();

    if (!res.ok || !data.activated) {
      return { activated: false, error: data.error || 'activation_failed' };
    }

    const status = data.license_key && data.license_key.status;
    const plan = planFromMeta(data.meta);
    const instanceId = data.instance && data.instance.id;

    await setStoredLicense({
      licenseKey,
      instanceId,
      status,
      plan: status === 'active' ? plan : 'free',
      lastValidatedAt: Date.now()
    });

    return { activated: true, instanceId, status, plan };
  } catch (err) {
    return { activated: false, error: err.message };
  }
}

async function validateLicense() {
  const stored = await getStoredLicense();
  if (!stored.licenseKey || !stored.instanceId) {
    return { valid: false, plan: 'free', status: 'inactive' };
  }

  try {
    const res = await fetch(`${LS_BASE}/licenses/validate`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        license_key: stored.licenseKey,
        instance_id: stored.instanceId
      })
    });
    const data = await res.json();

    if (!res.ok) {
      return { valid: false, plan: 'free', status: 'error' };
    }

    const status = data.license_key && data.license_key.status;
    const valid = Boolean(data.valid) && status === 'active';
    const plan = valid ? planFromMeta(data.meta) : 'free';

    await setStoredLicense({
      ...stored,
      status,
      plan,
      lastValidatedAt: Date.now()
    });

    return { valid, plan, status };
  } catch (err) {
    // ネットワークエラー時は直近の検証結果を維持（オフライン猶予）。
    return { valid: stored.status === 'active', plan: stored.plan, status: stored.status };
  }
}

async function deactivateLicense() {
  const stored = await getStoredLicense();
  if (!stored.licenseKey || !stored.instanceId) {
    await clearStoredLicense();
    return { deactivated: true };
  }

  try {
    const res = await fetch(`${LS_BASE}/licenses/deactivate`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        license_key: stored.licenseKey,
        instance_id: stored.instanceId
      })
    });
    const data = await res.json();

    if (res.ok && data.deactivated) {
      await clearStoredLicense();
      return { deactivated: true };
    }
    return { deactivated: false, error: data.error || 'deactivation_failed' };
  } catch (err) {
    return { deactivated: false, error: err.message };
  }
}

function getCheckoutUrl(plan) {
  return CHECKOUT_URLS[plan] || CHECKOUT_URLS.pro;
}

// 24時間ごとの再検証が必要かどうか
function needsRevalidation(license) {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return Date.now() - license.lastValidatedAt > ONE_DAY_MS;
}

export {
  getStoredLicense,
  activateLicense,
  validateLicense,
  deactivateLicense,
  getCheckoutUrl,
  needsRevalidation
};
