// AccessLens の簡易 E2E テスト。
// Playwright の persistent context で拡張機能を読み込み、
// 1) サービスワーカーがエラーなく起動するか
// 2) サイドパネル(panel.html)を直接開いて "Scan this page" を実行し、
//    結果（サマリー/グループ）が描画されるか
// 3) コンソール / ページエラーが出ていないか
// を確認する。

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..');
// 前回 Chrome を強制終了するとプロファイルがロックされたまま残り EPERM になることが
// あるため、毎回ユニークなディレクトリを使う。古いものの削除はベストエフォート。
const profilesRoot = path.resolve(__dirname, '.profiles');
const userDataDir = path.join(profilesRoot, `run-${Date.now()}`);
fs.mkdirSync(profilesRoot, { recursive: true });
try {
  for (const entry of fs.readdirSync(profilesRoot)) {
    fs.rmSync(path.join(profilesRoot, entry), { recursive: true, force: true, maxRetries: 1 });
  }
} catch (err) {
  // ロックされている古いプロファイルが残っても致命的ではないので無視する
}

// activeTab は「ユーザーが拡張機能を呼び出した(ツールバーアイコンをクリックする等)」
// 場合にのみ、その瞬間のアクティブタブに対して一時的に付与される。Playwright は
// ブラウザ chrome 部分のツールバーアイコンをクリックできないため、本物の拡張機能
// (activeTab のみ)をそのまま読み込むと「対象タブへスクリプト注入できない」状態
// から抜け出せず、スキャンの本体(axe-core実行〜結果描画〜PDF)を検証できない。
// そこで E2E 専用に、本番の拡張機能ディレクトリをコピーした上で
// manifest.json だけ「tabs」権限と host_permissions を緩めたコピーを作り、
// それを読み込む。本番の manifest.json は一切変更しない。
const TEST_EXT_EXCLUDE = new Set(['e2e', 'node_modules', '.git', '.profiles', 'package.json', 'package-lock.json']);
function prepareTestExtension(srcDir) {
  const testExtRoot = path.resolve(__dirname, '.test-ext');
  fs.mkdirSync(testExtRoot, { recursive: true });
  try {
    for (const entry of fs.readdirSync(testExtRoot)) {
      fs.rmSync(path.join(testExtRoot, entry), { recursive: true, force: true, maxRetries: 1 });
    }
  } catch (err) {
    // ベストエフォート
  }
  const destDir = path.join(testExtRoot, `ext-${Date.now()}`);
  copyDirRecursive(srcDir, destDir, TEST_EXT_EXCLUDE);

  const manifestPath = path.join(destDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // activeTab だけでは Playwright からスキャンの本筋を検証できないため、
  // テスト用コピーに限り tabs / host_permissions を広げて
  // 「ユーザー操作なしでも対象タブへ注入・URL取得できる」状態にする。
  if (!manifest.permissions.includes('tabs')) manifest.permissions.push('tabs');
  manifest.host_permissions = Array.from(new Set([...(manifest.host_permissions || []), '<all_urls>']));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return destDir;
}

function copyDirRecursive(src, dest, excludeNames) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludeNames.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, excludeNames);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const testExtensionPath = prepareTestExtension(extensionPath);
console.log('Test extension copy (with relaxed permissions for E2E only):', testExtensionPath);

// file:// で配信すると拡張機能には既定でアクセス権がなく
// (chrome://extensions の "Allow access to file URLs" がOFF) スクリプト注入が
// できない。実運用に近い http(s) で配信するため、固定ページを返す簡易サーバーを立てる。
function startFixtureServer() {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.html'));
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const errors = [];

function logSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const fixtureServer = await startFixtureServer();
  const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/sample.html`;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${testExtensionPath}`,
      `--load-extension=${testExtensionPath}`
    ]
  });

  context.on('weberror', (we) => {
    errors.push(`[weberror] ${we.error().message}`);
  });

  // --- 1. サービスワーカー(背景)の起動確認 ---
  logSection('Service worker');
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  }
  if (!sw) {
    errors.push('Service worker did not start within timeout.');
    console.log('NG: service worker not found');
  } else {
    console.log('OK:', sw.url());
  }

  const extensionId = sw ? sw.url().split('/')[2] : null;
  if (!extensionId) {
    console.log('Could not determine extension ID — aborting further checks.');
    await dumpAndExit(context, 1);
    return;
  }
  console.log('Extension ID:', extensionId);

  // --- 2. テスト対象ページを開く ---
  logSection('Open target page');
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[page console] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

  // file:// だと拡張機能に既定でアクセス権がなく注入できないため、
  // ローカルHTTPサーバー経由で配信して実運用に近い条件で検証する。
  await page.goto(fixtureUrl);
  console.log('OK: loaded', page.url());

  // --- 3. サイドパネル(panel.html)を直接開く ---
  logSection('Open panel.html');
  const panel = await context.newPage();
  panel.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(`[panel console] ${text}`);
    else console.log(`[panel console:${msg.type()}]`, text);
  });
  panel.on('pageerror', (err) => errors.push(`[panel pageerror] ${err.message}`));

  await panel.goto(`chrome-extension://${extensionId}/panel/panel.html`);
  await panel.waitForLoadState('domcontentloaded');
  console.log('OK: panel loaded');

  // 初期状態で summary/filters が本当に隠れているか（[hidden] 上書きバグの回帰チェック）
  logSection('Initial state (pre-scan)');
  const initiallyHiddenIds = ['al-summary', 'al-filters', 'al-export-pdf-btn'];
  for (const id of initiallyHiddenIds) {
    const visible = await panel.locator(`#${id}`).isVisible().catch(() => false);
    console.log(`#${id} visible before scan:`, visible);
    if (visible) {
      errors.push(`#${id} is visible before any scan has run (the [hidden] attribute is being overridden by CSS).`);
    }
  }

  // パネルは「現在アクティブなタブ」を対象にスキャンする実装。
  // このテストでは panel.html を独立タブとして開いているため、
  // 最後に newPage された/フォーカスされたものが「アクティブタブ」に
  // なってしまう。本物の側面パネルは決してアクティブタブにはならない
  // ので、対象ページ(page)をアクティブにしたまま panel 内のボタンだけを
  // 操作する（Playwright の操作はタブが最前面でなくても機能する）。
  await page.bringToFront();

  // --- UIを介さず、background へのメッセージを直接叩いて生のレスポンスを見る ---
  // 同時に background.js の内部デバッグログをポーリングし、
  // 「どの段階で時間がかかっている/止まっているか」を可視化する。
  logSection('Direct message round-trip (bypassing UI)');

  let lastLogLen = 0;
  const pollLog = setInterval(async () => {
    try {
      const { log } = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'al_debug_get_log' }));
      for (const line of log.slice(lastLogLen)) console.log('  [bg log]', line);
      lastLogLen = log.length;
    } catch (err) {
      // panel が一時的に評価不能でも無視して続行
    }
  }, 3000);

  try {
    const directPromise = panel.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const started = Date.now();
      const response = await chrome.runtime.sendMessage({
        type: 'al_scan_request',
        tabId: tab.id,
        url: tab.url,
        title: tab.title
      });
      return { tab: { id: tab.id, url: tab.url, title: tab.title }, response, elapsedMs: Date.now() - started };
    });

    // background側のタイムアウト(45s)より長く待ち、ハング自体も検出できるようにする
    const direct = await Promise.race([
      directPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('direct round-trip exceeded 90s — looks like a real hang')), 90000))
    ]);

    console.log('Direct round-trip result:', JSON.stringify(direct, null, 2).slice(0, 4000));
    if (!direct.response || !direct.response.ok) {
      errors.push(`Direct al_scan_request failed: ${JSON.stringify(direct.response)}`);
    }
  } catch (err) {
    console.log('Direct round-trip threw:', err.message);
    errors.push(`Direct al_scan_request threw: ${err.message}`);
  } finally {
    clearInterval(pollLog);
    // 取りこぼした残りのログを出力
    try {
      const { log } = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'al_debug_get_log' }));
      for (const line of log.slice(lastLogLen)) console.log('  [bg log]', line);
    } catch (err) {
      // ignore
    }
  }

  logSection('Run scan via UI');
  const scanBtn = panel.locator('#al-scan-btn');
  await scanBtn.waitFor({ state: 'visible', timeout: 10000 });
  await scanBtn.click();

  // ステータス文言かサマリーが出るまで待つ（最大60秒）。
  // 単に #al-summary が visible になるだけでは [hidden] 上書きバグのように
  // 「最初から見えている」ケースを誤判定するため、スコアの実値（"--" 以外の
  // 数値%表記）が描画されるまで待つ。
  const summary = panel.locator('#al-summary');
  const status = panel.locator('#al-scan-status');
  const scoreEl = panel.locator('#al-score-value');

  let scanFailed = false;
  try {
    await scoreEl.waitFor({ state: 'visible', timeout: 60000 });
    await panel.waitForFunction(
      () => {
        const el = document.getElementById('al-score-value');
        return el && /\d+%/.test(el.textContent || '');
      },
      { timeout: 60000 }
    );
  } catch (err) {
    scanFailed = true;
  }

  const statusText = (await status.textContent().catch(() => '')) || '';
  const summaryVisible = await summary.isVisible().catch(() => false);

  console.log('Status text:', JSON.stringify(statusText));
  console.log('Summary visible:', summaryVisible, '| Scan completed with score:', !scanFailed);

  if (scanFailed || !summaryVisible) {
    errors.push(`Scan did not complete with a rendered score. Status: "${statusText}"`);
  } else {
    const score = await panel.locator('#al-score-value').textContent();
    const groupCount = await panel.locator('.al-group').count();
    const violationCount = await panel.locator('.al-violation').count();
    console.log('Score:', score, '| WCAG groups:', groupCount, '| Violations rendered:', violationCount);

    if (groupCount === 0 || violationCount === 0) {
      errors.push(
        `Expected the fixture page (which has deliberate a11y issues) to produce violations, ` +
        `but found groups=${groupCount} violations=${violationCount}.`
      );
    }
  }

  await dumpAndExit(context, errors.length ? 1 : 0);
}

async function dumpAndExit(context, code) {
  logSection('Result');
  if (errors.length) {
    console.log(`FAILED with ${errors.length} issue(s):`);
    for (const e of errors) console.log(' -', e);
  } else {
    console.log('All checks passed.');
  }
  await context.close();
  process.exit(code);
}

main().catch(async (err) => {
  console.error('E2E run crashed:', err);
  process.exit(1);
});
