import { getStoredLicense } from '../licensing/lemonsqueezy.js';
import { getPlan, checkFeature, getScanLimit } from '../pricing/plans.js';
import {
  listClients,
  saveClient,
  listProjects,
  saveProject,
  saveScan,
  getScanCountToday,
  incrementScanCountToday,
  getSettings
} from '../storage/store.js';
import { createClient, createProject, createScan } from '../storage/schema.js';
import { generateWhiteLabelPdf } from '../report/pdf_generator.js';

// 専門用語に添える平易な説明（非開発者向けツールチップ）
const PLAIN_EXPLANATIONS = {
  'color-contrast': 'Text and its background color are too close in shade, making it hard to read for people with low vision.',
  'image-alt': 'Images need a short text description so screen readers can describe them to blind users.',
  label: 'Form fields need a visible label so people know what information to enter.',
  'link-name': 'Links need descriptive text so people using screen readers know where they lead.',
  'aria-required-attr': 'Some interactive elements are missing information that assistive technology needs to describe them.',
  'heading-order': 'Headings should follow a logical order (like a document outline) so screen reader users can navigate easily.',
  'frame-title': 'Embedded frames need a short title describing their content for screen reader users.',
  list: 'List items should be wrapped in a parent list element so screen readers announce them correctly.'
};

const state = {
  scanResult: null,
  pageUrl: '',
  pageTitle: '',
  license: null,
  filters: {
    impact: new Set(['critical', 'serious', 'moderate', 'minor']),
    level: new Set(['A', 'AA', 'AAA'])
  }
};

const els = {
  scanBtn: document.getElementById('al-scan-btn'),
  status: document.getElementById('al-scan-status'),
  summary: document.getElementById('al-summary'),
  scoreValue: document.getElementById('al-score-value'),
  impactBadges: document.getElementById('al-impact-badges'),
  filters: document.getElementById('al-filters'),
  results: document.getElementById('al-results'),
  exportBtn: document.getElementById('al-export-pdf-btn'),
  pdfLockedHint: document.getElementById('al-pdf-locked-hint')
};

async function init() {
  state.license = await getStoredLicense();
  els.scanBtn.addEventListener('click', onScanClick);
  els.exportBtn.addEventListener('click', onExportClick);

  document.querySelectorAll('.al-filter-impact').forEach((cb) => {
    cb.addEventListener('change', () => {
      toggleFilter(state.filters.impact, cb.value, cb.checked);
      renderResults();
    });
  });
  document.querySelectorAll('.al-filter-level').forEach((cb) => {
    cb.addEventListener('change', () => {
      toggleFilter(state.filters.level, cb.value, cb.checked);
      renderResults();
    });
  });

  updatePdfButtonState();
}

function toggleFilter(set, value, checked) {
  if (checked) set.add(value);
  else set.delete(value);
}

function setStatus(text, hidden = false) {
  els.status.textContent = text;
  els.status.hidden = hidden;
}

// background.js 側の SCAN_TIMEOUT_MS (45秒) より長く待ち、通常はそちらの
// タイムアウトが先に発火して分かりやすいエラーメッセージを返すようにする。
// それでも sendMessage 自体が解決も拒否もせず固まるケース
// (MV3 の service worker がメッセージに応答しなくなる既知の問題) があるため、
// パネル側にも独立したタイムアウトを設け、「スキャン中…」のまま無限に
// フリーズして見える状態（「かえってこない」）を防ぐ。
const PANEL_MESSAGE_TIMEOUT_MS = 60000;

function sendMessageWithTimeout(message, ms = PANEL_MESSAGE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            'No response from the extension after waiting a while. Chrome’s extension messaging may have become unresponsive — try reloading this page (or the side panel) and scanning again, or restart the browser if the problem continues.'
          )
        ),
      ms
    );
  });
  return Promise.race([chrome.runtime.sendMessage(message), timeout]).finally(() => clearTimeout(timer));
}

async function onScanClick() {
  const plan = state.license ? state.license.plan : 'free';
  const limit = getScanLimit(plan);
  const countToday = await getScanCountToday();

  if (countToday >= limit) {
    setStatus(`Daily scan limit reached (${limit}/day on the Free plan). Upgrade to Pro for unlimited scans.`);
    return;
  }

  els.scanBtn.disabled = true;

  // タブ情報はこのパネル（＝要求元ウィンドウ）から取得して渡す。
  // サービスワーカー側で currentWindow:true を使うと、複数ウィンドウ環境では
  // パネルとは別のウィンドウのアクティブタブを掴んでしまう可能性があるため。
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus('Could not find the active tab in this window.');
    els.scanBtn.disabled = false;
    return;
  }

  setStatus('Scanning current page… large or complex pages can take up to a minute.');
  // 長時間化した場合に「固まっている」と誤解されないよう、進行中であることを伝え続ける
  const progressTimer = setTimeout(() => {
    setStatus('Still scanning… axe-core is checking every element on this page, hang tight.');
  }, 8000);

  try {
    const response = await sendMessageWithTimeout({
      type: 'al_scan_request',
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    });
    clearTimeout(progressTimer);
    if (!response || !response.ok) {
      setStatus(`Scan failed: ${response ? response.error : 'unknown error'}`);
      els.scanBtn.disabled = false;
      return;
    }

    state.scanResult = response.result;
    state.pageUrl = response.pageUrl;
    state.pageTitle = response.pageTitle;

    await incrementScanCountToday();
    await persistScan(response.result, response.pageUrl);

    setStatus('', true);
    renderSummary(response.result.summary);
    renderResults();
    els.filters.hidden = false;
    els.summary.hidden = false;
    updatePdfButtonState();
  } catch (err) {
    setStatus(`Scan failed: ${err.message}`);
  } finally {
    clearTimeout(progressTimer);
    els.scanBtn.disabled = false;
  }
}

async function persistScan(result, url) {
  const clients = await listClients();
  let client = clients[0];
  if (!client) {
    client = createClient({ name: 'My First Client' });
    await saveClient(client);
  }

  const projects = await listProjects(client.id);
  let project = projects.find((p) => p.url === url);
  if (!project) {
    project = createProject({ clientId: client.id, name: state.pageTitle || url, url });
    await saveProject(project);
  }

  const scan = createScan({
    projectId: project.id,
    url,
    summary: result.summary,
    violations: result.violations,
    passes: result.passesCount,
    incomplete: result.incompleteCount
  });
  await saveScan(scan);
}

function renderSummary(summary) {
  els.scoreValue.textContent = `${summary.score}%`;
  els.impactBadges.innerHTML = '';
  const labels = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };
  for (const [impact, count] of Object.entries(summary.impactCounts)) {
    const badge = document.createElement('span');
    badge.className = `al-badge al-badge-${impact}`;
    badge.textContent = `${labels[impact]}: ${count}`;
    els.impactBadges.appendChild(badge);
  }
}

function passesFilters(violation) {
  if (!state.filters.impact.has(violation.impact)) return false;
  if (!state.filters.level.has(violation.criterion.level)) return false;
  return true;
}

function renderResults() {
  els.results.innerHTML = '';
  if (!state.scanResult) return;

  const visibleGroups = state.scanResult.groups
    .map((group) => ({
      criterion: group.criterion,
      violations: group.violations.filter(passesFilters)
    }))
    .filter((group) => group.violations.length > 0);

  if (visibleGroups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'al-empty';
    empty.textContent = 'No issues match the current filters. 🎉';
    els.results.appendChild(empty);
    return;
  }

  for (const group of visibleGroups) {
    els.results.appendChild(renderGroup(group));
  }
}

function renderGroup(group) {
  const wrapper = document.createElement('div');
  wrapper.className = 'al-group al-open';

  const header = document.createElement('div');
  header.className = 'al-group-header';
  header.innerHTML = `
    <span>${group.criterion.id} — ${group.criterion.name} <small style="font-weight:400;color:var(--al-muted)">(Level ${group.criterion.level})</small></span>
    <span class="al-chevron">▶</span>
  `;
  header.addEventListener('click', () => wrapper.classList.toggle('al-open'));

  const body = document.createElement('div');
  body.className = 'al-group-body';
  for (const violation of group.violations) {
    body.appendChild(renderViolation(violation));
  }

  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}

function renderViolation(violation) {
  const item = document.createElement('div');
  item.className = 'al-violation';

  const head = document.createElement('div');
  head.className = 'al-violation-head';

  const badge = document.createElement('span');
  badge.className = `al-impact-badge al-impact-${violation.impact}`;
  badge.textContent = violation.impact;

  const title = document.createElement('span');
  title.className = 'al-violation-title';
  title.textContent = violation.help;

  head.appendChild(badge);
  head.appendChild(title);

  const explanation = PLAIN_EXPLANATIONS[violation.id];
  if (explanation) {
    const tooltip = document.createElement('span');
    tooltip.className = 'al-tooltip';
    tooltip.textContent = '?';
    tooltip.title = explanation;
    head.appendChild(tooltip);
  }

  const desc = document.createElement('div');
  desc.className = 'al-violation-desc';
  desc.textContent = violation.description;

  const help = document.createElement('a');
  help.className = 'al-help-link';
  help.href = violation.helpUrl;
  help.target = '_blank';
  help.rel = 'noopener noreferrer';
  help.textContent = 'Learn more about this rule →';

  item.appendChild(head);
  item.appendChild(desc);

  for (const node of violation.nodes.slice(0, 5)) {
    item.appendChild(renderNode(node));
  }

  item.appendChild(help);
  return item;
}

function renderNode(node) {
  const box = document.createElement('div');
  box.className = 'al-node';

  const selector = document.createElement('div');
  selector.className = 'al-selector';
  selector.textContent = node.selector;
  selector.title = 'Click to copy selector';
  selector.addEventListener('click', () => {
    navigator.clipboard.writeText(node.selector);
    selector.textContent = 'Copied!';
    setTimeout(() => {
      selector.textContent = node.selector;
    }, 1000);
  });

  box.appendChild(selector);

  if (node.failureSummary) {
    const fix = document.createElement('div');
    fix.className = 'al-fix-suggestion';
    fix.textContent = node.failureSummary;
    box.appendChild(fix);
  }

  return box;
}

function updatePdfButtonState() {
  const plan = state.license ? state.license.plan : 'free';
  const allowed = checkFeature(plan, 'pdfExport');
  els.exportBtn.hidden = !state.scanResult;
  els.pdfLockedHint.hidden = allowed || !state.scanResult;
  els.exportBtn.disabled = !allowed;
  els.exportBtn.textContent = allowed ? 'Export white-label PDF' : 'Export white-label PDF (Pro)';
}

async function onExportClick() {
  if (!state.scanResult) return;
  const plan = state.license ? state.license.plan : 'free';
  if (!checkFeature(plan, 'pdfExport')) return;

  const settings = await getSettings();
  setStatus('Generating PDF report…', false);
  try {
    await generateWhiteLabelPdf({
      result: state.scanResult,
      pageUrl: state.pageUrl,
      pageTitle: state.pageTitle,
      companyName: settings.companyName,
      logoDataUrl: settings.logoDataUrl,
      accentColor: settings.accentColor
    });
    setStatus('', true);
  } catch (err) {
    setStatus(`PDF generation failed: ${err.message}`);
  }
}

init();
