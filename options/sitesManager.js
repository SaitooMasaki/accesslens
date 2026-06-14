import { getStoredLicense } from '../licensing/lemonsqueezy.js';
import { getCheckoutUrl } from '../licensing/lemonsqueezy.js';
import { fetchSites, createSite, updateSite, deleteSite } from './sitesService.js';

const el = {
  gate:       () => document.getElementById('al-sites-gate'),
  loading:    () => document.getElementById('al-sites-loading'),
  empty:      () => document.getElementById('al-sites-empty'),
  error:      () => document.getElementById('al-sites-error'),
  table:      () => document.getElementById('al-sites-table'),
  tbody:      () => document.getElementById('al-sites-tbody'),
  form:       () => document.getElementById('al-site-form'),
  urlInput:   () => document.getElementById('al-site-url'),
  labelInput: () => document.getElementById('al-site-label'),
  interval:   () => document.getElementById('al-site-interval'),
  addBtn:     () => document.getElementById('al-site-add-btn'),
  formError:  () => document.getElementById('al-site-form-error'),
};

let sites = [];

export async function initSites() {
  const license = await getStoredLicense();

  if (license.plan !== 'agency') {
    el.gate().hidden = false;
    el.form().hidden = true;
    document.getElementById('al-sites-upgrade').addEventListener('click', () => {
      chrome.tabs.create({ url: getCheckoutUrl('pro') });
    });
    return;
  }

  el.form().addEventListener('submit', onAddSite);
  await loadSites();
}

async function loadSites() {
  el.loading().hidden = false;
  el.error().hidden   = true;
  el.table().hidden   = true;
  el.empty().hidden   = true;

  try {
    sites = await fetchSites();
    renderSites();
  } catch (err) {
    showError(el.error(), `Failed to load sites: ${err.message}`);
  } finally {
    el.loading().hidden = true;
  }
}

function renderSites() {
  if (!sites.length) {
    el.empty().hidden = false;
    el.table().hidden = true;
    return;
  }
  el.empty().hidden = true;
  el.table().hidden = false;
  el.tbody().innerHTML = '';
  for (const site of sites) {
    el.tbody().appendChild(buildRow(site));
  }
}

function buildRow(site) {
  const tr = document.createElement('tr');
  tr.dataset.id = site.id;
  tr.innerHTML = `
    <td>
      <div class="al-site-label">${escHtml(site.label || '—')}</div>
      <div class="al-site-url">${escHtml(site.url)}</div>
    </td>
    <td class="al-site-interval">${site.scan_interval}</td>
    <td class="al-site-actions">
      <button class="al-link-btn al-edit-btn">Edit</button>
      <button class="al-link-btn al-delete-btn al-delete-color">Delete</button>
    </td>`;
  tr.querySelector('.al-edit-btn').addEventListener('click', () => showEditRow(tr, site));
  tr.querySelector('.al-delete-btn').addEventListener('click', () => onDelete(site));
  return tr;
}

function showEditRow(tr, site) {
  tr.innerHTML = `
    <td colspan="2">
      <div class="al-site-edit-fields">
        <input class="al-site-edit-label" type="text" value="${escHtml(site.label || '')}" placeholder="Label" />
        <select class="al-site-edit-interval">
          <option value="weekly" ${site.scan_interval === 'weekly' ? 'selected' : ''}>Weekly</option>
          <option value="daily"  ${site.scan_interval === 'daily'  ? 'selected' : ''}>Daily</option>
        </select>
      </div>
    </td>
    <td class="al-site-actions">
      <button class="al-link-btn al-save-btn">Save</button>
      <button class="al-link-btn al-cancel-btn">Cancel</button>
    </td>`;
  tr.querySelector('.al-save-btn').addEventListener('click',   () => onSave(tr, site));
  tr.querySelector('.al-cancel-btn').addEventListener('click', () => tr.replaceWith(buildRow(site)));
}

async function onSave(tr, site) {
  const label         = tr.querySelector('.al-site-edit-label').value.trim();
  const scan_interval = tr.querySelector('.al-site-edit-interval').value;
  try {
    const updated = await updateSite(site.id, { label: label || null, scan_interval });
    const idx = sites.findIndex(s => s.id === site.id);
    if (idx >= 0) sites[idx] = updated;
    tr.replaceWith(buildRow(updated));
  } catch (err) {
    showError(el.error(), `Failed to update: ${err.message}`);
  }
}

async function onDelete(site) {
  if (!confirm(`Delete "${site.label || site.url}"?`)) return;

  // 楽観的更新
  el.tbody().querySelector(`tr[data-id="${site.id}"]`)?.remove();
  sites = sites.filter(s => s.id !== site.id);
  if (!sites.length) { el.table().hidden = true; el.empty().hidden = false; }

  try {
    await deleteSite(site.id);
  } catch (err) {
    // ロールバック
    await loadSites();
    showError(el.error(), `Failed to delete: ${err.message}`);
  }
}

async function onAddSite(e) {
  e.preventDefault();
  el.formError().hidden = true;

  const url           = el.urlInput().value.trim();
  const label         = el.labelInput().value.trim();
  const scan_interval = el.interval().value;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    showError(el.formError(), 'Only http:// and https:// URLs are allowed.');
    return;
  }
  try { new URL(url); } catch {
    showError(el.formError(), 'Please enter a valid URL (e.g. https://example.com).');
    return;
  }

  el.addBtn().disabled = true;
  try {
    const site = await createSite({ url, label: label || undefined, scan_interval });
    sites.unshift(site);
    el.urlInput().value = '';
    el.labelInput().value = '';
    el.interval().value = 'weekly';
    renderSites();
  } catch (err) {
    showError(el.formError(), err.message);
  } finally {
    el.addBtn().disabled = false;
  }
}

function showError(elem, msg) {
  elem.textContent = msg;
  elem.hidden = false;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
