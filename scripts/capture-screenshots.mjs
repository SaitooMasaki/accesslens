// Chrome ウェブストア掲載用のスクリーンショットを実機キャプチャ・合成するスクリプト。
//
// 方針:
// 1. テスト専用に権限を緩めた拡張機能のコピーを読み込み、実際にスキャンを実行する
// 2. 各UI（サイドパネル/ポップアップ/オプション）を「実物に近い自然なサイズ」で撮影する
//    （側面パネルは横幅が狭い実物のUIなので、1280px幅で開くとレイアウトが崩れて
//      不安定になる。等倍の自然なサイズで撮ってから合成する）
// 3. Chromeウェブストアが要求する 1280x800 の画像に、対象ページ＋パネルを
//    横並びにした「実際の使用イメージ」として合成する
//
// 出力先: scripts/screenshots/

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..');
const profilesRoot = path.resolve(__dirname, '.profiles');
const userDataDir = path.join(profilesRoot, `shot-${Date.now()}`);
fs.mkdirSync(profilesRoot, { recursive: true });
try {
  for (const entry of fs.readdirSync(profilesRoot)) {
    fs.rmSync(path.join(profilesRoot, entry), { recursive: true, force: true, maxRetries: 1 });
  }
} catch (err) {}

const rawDir = path.resolve(__dirname, 'screenshots', 'raw');
const outDir = path.resolve(__dirname, 'screenshots');
fs.mkdirSync(rawDir, { recursive: true });

const TEST_EXT_EXCLUDE = new Set(['e2e', 'scripts', 'node_modules', '.git', 'package.json', 'package-lock.json', 'docs']);
function copyDirRecursive(src, dest, excludeNames) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludeNames.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(srcPath, destPath, excludeNames);
    else if (entry.isFile()) fs.copyFileSync(srcPath, destPath);
  }
}
function prepareTestExtension(srcDir) {
  const root = path.resolve(__dirname, '.test-ext');
  fs.mkdirSync(root, { recursive: true });
  try {
    for (const entry of fs.readdirSync(root)) fs.rmSync(path.join(root, entry), { recursive: true, force: true, maxRetries: 1 });
  } catch (err) {}
  const dest = path.join(root, `ext-${Date.now()}`);
  copyDirRecursive(srcDir, dest, TEST_EXT_EXCLUDE);
  const manifestPath = path.join(dest, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.permissions.includes('tabs')) manifest.permissions.push('tabs');
  manifest.host_permissions = Array.from(new Set([...(manifest.host_permissions || []), '<all_urls>']));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dest;
}

function startFixtureServer() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'e2e', 'fixtures', 'sample.html'));
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const STORE_SIZE = { width: 1280, height: 800 };
// サイドパネルの実物に近い幅。Chromeのデフォルト側面パネル幅は概ね 320-400px 程度。
const PANEL_VIEWPORT = { width: 392, height: 760 };
const POPUP_VIEWPORT = { width: 360, height: 520 };

async function shoot(pg, file, opts = {}) {
  await pg.screenshot({ path: file, animations: 'disabled', timeout: 60000, ...opts });
}

async function main() {
  const testExtensionPath = prepareTestExtension(extensionPath);
  const fixtureServer = await startFixtureServer();
  const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/sample.html`;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${testExtensionPath}`,
      `--load-extension=${testExtensionPath}`
    ]
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  const extensionId = sw.url().split('/')[2];
  console.log('Extension ID:', extensionId);

  // --- 1. 対象ページ（フィクスチャ：意図的にa11y違反を含む） ---
  const page = await context.newPage();
  await page.setViewportSize({ width: 1000, height: PANEL_VIEWPORT.height });
  await page.goto(fixtureUrl);
  await page.bringToFront();
  await page.waitForTimeout(300);
  await shoot(page, path.join(rawDir, 'page.png'));

  // --- 2. サイドパネル：実物に近い幅で開いてスキャンを実行 ---
  const panel = await context.newPage();
  await panel.setViewportSize(PANEL_VIEWPORT);
  await panel.goto(`chrome-extension://${extensionId}/panel/panel.html`);
  await panel.waitForLoadState('domcontentloaded');

  await page.bringToFront();
  const scanBtn = panel.locator('#al-scan-btn');
  await scanBtn.waitFor({ state: 'visible', timeout: 10000 });
  await scanBtn.click();

  // 拡張ページのCSP(script-src 'self')が waitForFunction の eval を拒否するため
  // テキストを手動でポーリングする
  const scoreEl = panel.locator('#al-score-value');
  const deadline = Date.now() + 60000;
  let scoreText = '';
  while (Date.now() < deadline) {
    scoreText = (await scoreEl.textContent().catch(() => '')) || '';
    if (/\d+%/.test(scoreText)) break;
    await panel.waitForTimeout(500);
  }
  if (!/\d+%/.test(scoreText)) throw new Error(`Scan did not complete in time (last: "${scoreText}")`);
  console.log('Scan complete, score:', scoreText);
  await panel.waitForTimeout(500);
  await shoot(panel, path.join(rawDir, 'panel-results.png'));

  // --- 3. オプションページ（料金プラン比較表） ---
  const options = await context.newPage();
  await options.setViewportSize(STORE_SIZE);
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.waitForLoadState('domcontentloaded');
  await options.waitForTimeout(400);
  // 「Pricing plans」セクション(料金比較表)が見える位置までスクロールしてから撮る
  await options.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Pricing plans');
    if (heading) heading.scrollIntoView({ block: 'start' });
  }).catch(() => {});
  await options.waitForTimeout(400);
  await shoot(options, path.join(rawDir, 'options.png'));

  // --- 4. ポップアップ ---
  const popup = await context.newPage();
  await popup.setViewportSize(POPUP_VIEWPORT);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(300);
  // ポップアップの実コンテンツ(.al-popup)だけを撮る。ページ全体を撮ると
  // bodyの余白(空白)が大きく写り込んでしまうため、要素単位でキャプチャする。
  const popupCard = popup.locator('.al-popup');
  await popupCard.waitFor({ state: 'visible', timeout: 10000 });
  await popupCard.screenshot({ path: path.join(rawDir, 'popup.png'), animations: 'disabled', timeout: 60000 });

  await context.close();

  // --- 合成: 1280x800 のストア掲載用画像を組み立てる ---
  console.log('\nCompositing store-ready 1280x800 images...');
  const compositor = await chromium.launch();

  await composeSideBySide(compositor, {
    leftImg: path.join(rawDir, 'page.png'),
    rightImg: path.join(rawDir, 'panel-results.png'),
    caption: 'Scan any page and get instant WCAG results in the side panel',
    out: path.join(outDir, '01-scan-results.png')
  });

  await composeCentered(compositor, {
    img: path.join(rawDir, 'options.png'),
    fit: 'width',
    caption: 'Pick the plan that fits your agency — unlimited scans & white-label PDF reports with Pro',
    out: path.join(outDir, '02-pricing-plans.png')
  });

  await composeCentered(compositor, {
    img: path.join(rawDir, 'popup.png'),
    fit: 'height',
    caption: 'One click from the toolbar — see your plan, scan count, and start scanning',
    out: path.join(outDir, '03-popup.png')
  });

  await compositor.close();
  console.log('\nDone. Store-ready screenshots written to', outDir);
  process.exit(0);
}

function toDataUrl(file) {
  const buf = fs.readFileSync(file);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function composeSideBySide(browser, { leftImg, rightImg, caption, out }) {
  const html = `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      width:${STORE_SIZE.width}px; height:${STORE_SIZE.height}px;
      background: linear-gradient(135deg, #EFF6FF 0%, #F9FAFB 60%);
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:28px; overflow:hidden;
    }
    .row { display:flex; align-items:flex-end; gap:0; }
    .left {
      box-shadow: 0 24px 64px -24px rgba(15,23,42,0.35);
      border-radius: 10px 0 0 10px; overflow:hidden; border:1px solid #E5E7EB; border-right:none;
    }
    .right {
      box-shadow: 0 24px 64px -24px rgba(15,23,42,0.45);
      border-radius: 0 14px 14px 0; overflow:hidden; border:1px solid #E5E7EB;
      position:relative; z-index:2;
    }
    img { display:block; }
    .left img { height: 560px; width:auto; object-fit:cover; object-position: top left; }
    .right img { height: 560px; width:auto; }
    .caption {
      font-size: 25px; font-weight: 700; color:#1F2937; text-align:center; max-width:980px; line-height:1.4;
    }
    .badge {
      display:inline-block; background:#2563EB; color:white; font-weight:700; font-size:14px;
      border-radius:999px; padding:5px 16px; letter-spacing:0.02em;
    }
    .top { display:flex; flex-direction:column; align-items:center; gap:14px; }
  </style></head><body>
    <div class="top">
      <span class="badge">AccessLens — Web Accessibility Checker</span>
      <div class="caption">${caption}</div>
    </div>
    <div class="row">
      <div class="left"><img src="${toDataUrl(leftImg)}" /></div>
      <div class="right"><img src="${toDataUrl(rightImg)}" /></div>
    </div>
  </body></html>`;
  const page = await browser.newPage({ viewport: STORE_SIZE, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForTimeout(200);
  await page.screenshot({ path: out, animations: 'disabled' });
  await page.close();
  console.log('Wrote', out);
}

async function composeCentered(browser, { img, fit, caption, out }) {
  const sizeRule = fit === 'height'
    ? 'img { height: 620px; width:auto; }'
    : 'img { width: 1040px; height:auto; }';
  const html = `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      width:${STORE_SIZE.width}px; height:${STORE_SIZE.height}px;
      background: linear-gradient(135deg, #EFF6FF 0%, #F9FAFB 60%);
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:24px; overflow:hidden;
    }
    .frame {
      box-shadow: 0 24px 64px -24px rgba(15,23,42,0.4);
      border-radius: 14px; overflow:hidden; border:1px solid #E5E7EB; background:#fff;
    }
    ${sizeRule}
    img { display:block; }
    .caption { font-size: 25px; font-weight: 700; color:#1F2937; text-align:center; max-width:980px; line-height:1.4; }
    .badge {
      display:inline-block; background:#2563EB; color:white; font-weight:700; font-size:14px;
      border-radius:999px; padding:5px 16px; letter-spacing:0.02em;
    }
    .top { display:flex; flex-direction:column; align-items:center; gap:14px; }
  </style></head><body>
    <div class="top">
      <span class="badge">AccessLens — Web Accessibility Checker</span>
      <div class="caption">${caption}</div>
    </div>
    <div class="frame"><img src="${toDataUrl(img)}" /></div>
  </body></html>`;
  const page = await browser.newPage({ viewport: STORE_SIZE, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForTimeout(200);
  await page.screenshot({ path: out, animations: 'disabled' });
  await page.close();
  console.log('Wrote', out);
}

main().catch((err) => {
  console.error('CRASHED:', err);
  process.exit(1);
});
