import {
  getStoredLicense,
  activateLicense,
  validateLicense,
  deactivateLicense,
  getCheckoutUrl
} from '../licensing/lemonsqueezy.js';
import { getSettings, saveSettings } from '../storage/store.js';

const els = {
  companyName: document.getElementById('al-company-name'),
  logoFile: document.getElementById('al-logo-file'),
  logoPreview: document.getElementById('al-logo-preview'),
  logoImg: document.getElementById('al-logo-img'),
  logoRemove: document.getElementById('al-logo-remove'),
  accentColor: document.getElementById('al-accent-color'),
  wcagLevel: document.getElementById('al-wcag-level'),
  saveBtn: document.getElementById('al-save-settings'),
  savedMsg: document.getElementById('al-settings-saved'),

  licenseStatus: document.getElementById('al-license-status'),
  licenseKey: document.getElementById('al-license-key'),
  activateBtn: document.getElementById('al-activate-btn'),
  deactivateBtn: document.getElementById('al-deactivate-btn'),
  licenseMessage: document.getElementById('al-license-message'),

  upgradePro: document.getElementById('al-upgrade-pro'),
  upgradeAgency: document.getElementById('al-upgrade-agency')
};

let pendingLogoDataUrl = null;

async function init() {
  await loadSettings();
  await loadLicense();
  bindEvents();
}

async function loadSettings() {
  const settings = await getSettings();
  els.companyName.value = settings.companyName || '';
  els.accentColor.value = settings.accentColor || '#2563EB';
  els.wcagLevel.value = settings.defaultWcagLevel || 'AA';
  if (settings.logoDataUrl) {
    showLogoPreview(settings.logoDataUrl);
    pendingLogoDataUrl = settings.logoDataUrl;
  }
}

function showLogoPreview(dataUrl) {
  els.logoImg.src = dataUrl;
  els.logoPreview.hidden = false;
}

function hideLogoPreview() {
  els.logoImg.src = '';
  els.logoPreview.hidden = true;
}

async function loadLicense() {
  let license = await getStoredLicense();
  if (license.licenseKey) {
    // Options を開くたびに最新の権利状態を反映する（バックグラウンドの定期検証とは別に、
    // ユーザーがアクティベート直後の状態を確認できるようにするため）。
    await validateLicense();
    license = await getStoredLicense();
  }
  renderLicenseStatus(license);
  if (license.licenseKey) {
    els.licenseKey.value = license.licenseKey;
  }
}

function renderLicenseStatus(license) {
  const planLabel = license.plan ? license.plan.charAt(0).toUpperCase() + license.plan.slice(1) : 'Free';
  if (!license.licenseKey) {
    els.licenseStatus.textContent = 'Status: Not activated (Free plan)';
  } else {
    els.licenseStatus.textContent = `Status: ${license.status} — Plan: ${planLabel}`;
  }
}

function bindEvents() {
  els.logoFile.addEventListener('change', onLogoSelected);
  els.logoRemove.addEventListener('click', () => {
    pendingLogoDataUrl = '';
    els.logoFile.value = '';
    hideLogoPreview();
  });
  els.saveBtn.addEventListener('click', onSaveSettings);

  els.activateBtn.addEventListener('click', onActivate);
  els.deactivateBtn.addEventListener('click', onDeactivate);

  els.upgradePro.addEventListener('click', () => chrome.tabs.create({ url: getCheckoutUrl('pro') }));

  // Agency はまだ Phase2機能(定期スキャン/メールダイジェスト/クラウド同期)が
  // 未実装で、Lemon Squeezy側の商品ページもまだ用意できていない。
  // ここでチェックアウトに飛ばすと404になり購入者を混乱させるため、
  // 商品の公開準備が整うまではボタンを非活性にし、案内文に差し替えておく。
  els.upgradeAgency.disabled = true;
  els.upgradeAgency.title = 'Agency plan is coming soon — not available for purchase yet.';
  els.upgradeAgency.textContent = 'Coming soon';
}

function onLogoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingLogoDataUrl = reader.result;
    showLogoPreview(pendingLogoDataUrl);
  };
  reader.readAsDataURL(file);
}

async function onSaveSettings() {
  const settings = {
    companyName: els.companyName.value.trim(),
    logoDataUrl: pendingLogoDataUrl === null ? (await getSettings()).logoDataUrl : pendingLogoDataUrl,
    accentColor: els.accentColor.value,
    defaultWcagLevel: els.wcagLevel.value
  };
  await saveSettings(settings);
  els.savedMsg.hidden = false;
  setTimeout(() => {
    els.savedMsg.hidden = true;
  }, 1800);
}

async function onActivate() {
  const key = els.licenseKey.value.trim();
  if (!key) {
    els.licenseMessage.textContent = 'Enter a license key first.';
    return;
  }
  els.licenseMessage.textContent = 'Activating…';
  els.activateBtn.disabled = true;
  try {
    const result = await activateLicense(key);
    if (result.activated) {
      els.licenseMessage.textContent = `Activated! Plan: ${result.plan}`;
      await loadLicense();
    } else {
      els.licenseMessage.textContent = `Activation failed: ${formatLicenseError(result.error)}`;
    }
  } finally {
    els.activateBtn.disabled = false;
  }
}

async function onDeactivate() {
  els.licenseMessage.textContent = 'Deactivating…';
  els.deactivateBtn.disabled = true;
  try {
    const result = await deactivateLicense();
    if (result.deactivated) {
      els.licenseMessage.textContent = 'License deactivated. You are back on the Free plan.';
      els.licenseKey.value = '';
      await loadLicense();
    } else {
      els.licenseMessage.textContent = `Deactivation failed: ${formatLicenseError(result.error)}`;
    }
  } finally {
    els.deactivateBtn.disabled = false;
  }
}

function formatLicenseError(error) {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  return error.message || JSON.stringify(error);
}

init();
