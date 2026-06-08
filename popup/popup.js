import { getStoredLicense, getCheckoutUrl } from '../licensing/lemonsqueezy.js';
import { getScanLimit } from '../pricing/plans.js';
import { getScanCountToday } from '../storage/store.js';

const els = {
  planBadge: document.getElementById('al-plan-badge'),
  scanCount: document.getElementById('al-scan-count'),
  scanBtn: document.getElementById('al-scan-btn'),
  upgradeBtn: document.getElementById('al-upgrade-btn'),
  settingsLink: document.getElementById('al-settings-link')
};

async function init() {
  const license = await getStoredLicense();
  const plan = license.plan || 'free';
  const limit = getScanLimit(plan);
  const countToday = await getScanCountToday();

  els.planBadge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
  els.planBadge.className = `al-plan-badge al-plan-${plan}`;

  els.scanCount.textContent = limit === Infinity ? `${countToday} / ∞` : `${countToday} / ${limit}`;

  if (plan === 'free') {
    els.upgradeBtn.hidden = false;
    els.upgradeBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: getCheckoutUrl('pro') });
    });
  }

  els.scanBtn.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab && tab.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
    window.close();
  });

  els.settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
