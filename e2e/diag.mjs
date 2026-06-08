// 最小診断: 拡張機能のメッセージングが根本的に機能しているかを切り分ける。
// 1) service worker が起動するか
// 2) sw.evaluate で SW コンテキストに直接アクセスできるか
// 3) 拡張ページ(panel)から chrome.runtime.sendMessage で「即答すべき」軽量メッセージ
//    (al_debug_get_log) が時間内に返ってくるか
// それぞれに個別の短いタイムアウトを付け、どこで詰まるかを特定する。

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..');
const profilesRoot = path.resolve(__dirname, '.profiles');
const userDataDir = path.join(profilesRoot, `diag-${Date.now()}`);
fs.mkdirSync(profilesRoot, { recursive: true });

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise.then((v) => ({ ok: true, value: v })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, timedOut: true, label }), ms))
  ]);
}

async function main() {
  console.log('Launching persistent context...');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  console.log('Launched.');

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  console.log('Service worker:', sw ? sw.url() : 'NOT FOUND');
  const extensionId = sw ? sw.url().split('/')[2] : null;
  console.log('Extension ID:', extensionId);

  console.log('\n--- Step 1: sw.evaluate(() => 1+1) ---');
  const r1 = await withTimeout(sw.evaluate(() => 1 + 1), 10000, 'sw.evaluate basic');
  console.log('Result:', JSON.stringify(r1));

  console.log('\n--- Step 2: sw.evaluate(() => globalThis.__al_debugLog) ---');
  const r2 = await withTimeout(sw.evaluate(() => globalThis.__al_debugLog || 'undefined'), 10000, 'sw.evaluate debugLog');
  console.log('Result:', JSON.stringify(r2));

  console.log('\n--- Step 3: sw.evaluate(() => typeof chrome.runtime.onMessage) ---');
  const r3 = await withTimeout(
    sw.evaluate(() => ({
      hasOnMessage: typeof chrome.runtime.onMessage,
      hasListeners: chrome.runtime.onMessage.hasListeners ? chrome.runtime.onMessage.hasListeners() : 'n/a'
    })),
    10000,
    'sw.evaluate onMessage check'
  );
  console.log('Result:', JSON.stringify(r3));

  console.log('\n--- Step 4: open an extension page (options.html) ---');
  const optPage = await context.newPage();
  optPage.on('console', (m) => console.log('  [options console]', m.type(), m.text()));
  optPage.on('pageerror', (e) => console.log('  [options pageerror]', e.message));
  await optPage.goto(`chrome-extension://${extensionId}/options/options.html`);
  await optPage.waitForLoadState('domcontentloaded');
  console.log('Options page loaded:', optPage.url());

  console.log('\n--- Step 5: from options page, chrome.runtime.sendMessage({type: "al_debug_get_log"}) ---');
  const r5 = await withTimeout(
    optPage.evaluate(() => chrome.runtime.sendMessage({ type: 'al_debug_get_log' })),
    15000,
    'sendMessage al_debug_get_log'
  );
  console.log('Result:', JSON.stringify(r5));

  console.log('\n--- Step 6: from options page, sendMessage with an UNKNOWN type (sanity: does the channel respond at all?) ---');
  const r6 = await withTimeout(
    optPage.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'al_unknown_probe' }, (response) => {
            resolve({ response, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message });
          });
        })
    ),
    15000,
    'sendMessage unknown type (callback style)'
  );
  console.log('Result:', JSON.stringify(r6));

  console.log('\nDone. Closing context.');
  await context.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('CRASHED:', err);
  process.exit(1);
});
