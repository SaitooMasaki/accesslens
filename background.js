// サービスワーカー: スキャンのオーケストレーション、サイドパネルの開閉、
// 起動時+24時間ごとのライセンス再検証を行う。
// chrome.scripting / chrome.tabs は拡張コンテキスト（ここ）でのみ使えるため、
// 「対象タブへのスクリプト注入とスキャン実行」はここに置く。
// 実際にページ内で axe-core を動かすランナーは content/content.js が担う。

import { validateLicense, needsRevalidation, getStoredLicense } from './licensing/lemonsqueezy.js';
import { syncAll } from './sync/syncService.js';

const REVALIDATE_ALARM = 'al_revalidate_license';
const SCAN_TIMEOUT_MS = 45000; // axe-core は複雑なページで数十秒かかることがあるため余裕を持たせる

// 軽量なリングバッファ式デバッグログ。サポート対応や E2E テストで
// 「スキャンのどの段階で止まっているか」を service worker の外から
// (chrome://extensions のサービスワーカー検証、または sw.evaluate) 確認できるようにする。
const DEBUG_LOG_LIMIT = 80;
globalThis.__al_debugLog = globalThis.__al_debugLog || [];
function debugLog(...args) {
  const entry = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`;
  globalThis.__al_debugLog.push(entry);
  if (globalThis.__al_debugLog.length > DEBUG_LOG_LIMIT) globalThis.__al_debugLog.shift();
  console.log('[AccessLens]', ...args);
}

// 起動・インストール時にクラウド同期を試みる（Agency プランで JWT があれば実行）
chrome.runtime.onInstalled.addListener(() => {
  syncAll().catch(() => {});
  chrome.alarms.create(REVALIDATE_ALARM, { periodInMinutes: 60 * 24 });
  revalidateIfNeeded();
});

chrome.runtime.onStartup.addListener(() => {
  revalidateIfNeeded();
  syncAll().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REVALIDATE_ALARM) {
    revalidateIfNeeded(true);
  }
});

async function revalidateIfNeeded(force = false) {
  const license = await getStoredLicense();
  if (!license.licenseKey) return;
  if (force || needsRevalidation(license)) {
    await validateLicense();
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// すでに axe-core / scanner / runner がそのタブに注入済みかどうかを確認する。
// 553KBの axe.min.js を毎回再注入・再実行するのは無駄でスキャン開始を遅らせるため、
// 2回目以降のスキャンでは再注入をスキップする。
async function isRunnerReady(tabId) {
  debugLog('isRunnerReady: checking tab', tabId);
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__al_runScan && window.axe)
    });
    debugLog('isRunnerReady: probe result =', result);
    return Boolean(result);
  } catch (err) {
    debugLog('isRunnerReady: probe threw —', err.message);
    return false;
  }
}

// 動的注入: axe-core → スキャナ → ランナー の順に同じ(isolated)worldへ注入し、
// 最後に window.__al_runScan(url) を呼び出して非同期の結果を取得する。
// 注入済みであればスキップして起動を高速化する。
async function injectRunnerIfNeeded(tabId) {
  if (await isRunnerReady(tabId)) {
    debugLog('injectRunnerIfNeeded: already injected, skipping');
    return;
  }
  debugLog('injectRunnerIfNeeded: injecting axe.min.js');
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/axe.min.js'] });
  debugLog('injectRunnerIfNeeded: injecting scanner.js');
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/scanner.js'] });
  debugLog('injectRunnerIfNeeded: injecting content.js');
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
  debugLog('injectRunnerIfNeeded: done');
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runAxeScan(tabId, url) {
  debugLog('runAxeScan: invoking window.__al_runScan on tab', tabId);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (pageUrl) => window.__al_runScan(pageUrl),
    args: [url || null]
  });
  debugLog('runAxeScan: got result, violations =', result && result.violations && result.violations.length);
  return result;
}

// chrome.scripting.executeScript はスクリプト実行不可なページに対して
// すぐにエラーを返さず長時間応答しないことがある。代表的に注入できないページを
// 事前に弾き、待たせずにフレンドリーなメッセージを返す。
const UNSCRIPTABLE_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'devtools://',
  'edge://',
  'about:',
  'https://chrome.google.com/webstore',
  'https://chromewebstore.google.com'
];

function isScriptableUrl(url) {
  if (!url) return false;
  return !UNSCRIPTABLE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function scanPage(tabId, url) {
  // タイムアウトは注入フェーズも含めた全体に適用する。
  // chrome.scripting.executeScript はスクリプト実行不可なページ
  // (chrome://, Chrome ウェブストア, 拡張機能自身のページ等) を対象にすると
  // エラーで即座に reject されず、長時間応答が返らないことがあるため、
  // 注入だけを timeout の外に置くと「かえってこない」状態になり得る。
  return withTimeout(
    (async () => {
      await injectRunnerIfNeeded(tabId);
      return runAxeScan(tabId, url);
    })(),
    SCAN_TIMEOUT_MS,
    'Scan timed out. This page may be very large, contain many cross-origin frames, or be a page the browser does not allow extensions to script (e.g. chrome:// pages, the Chrome Web Store, or the extension’s own pages).'
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'al_scan_request') {
    debugLog('al_scan_request received', JSON.stringify({ tabId: message.tabId, url: message.url }));
    (async () => {
      try {
        // タブ情報はパネル側（要求元ウィンドウ）から渡してもらう。
        // サービスワーカーから currentWindow:true で問い合わせると、
        // 複数ウィンドウ環境でパネルとは別のウィンドウのタブを掴むことがあるため避ける。
        let { tabId, url, title } = message;
        if (!tabId) {
          debugLog('al_scan_request: no tabId provided');
          sendResponse({ ok: false, error: 'no_active_tab' });
          return;
        }

        // パネル(activeTab の付与元とは限らない)から渡された url/title が
        // 欠けていることがある。サイドパネルは開いたままタブを切り替えられる UI のため、
        // 「拡張機能のアイコンをクリックした瞬間のタブ」と「スキャンボタンを押した時に
        // アクティブなタブ」が異なるケースが普通に起こる。その場合 activeTab の一時許可が
        // 新しいタブには付与されておらず、chrome.tabs.query が url/title を返さない
        // (undefined になる) ことがある。ここで url が無いというだけで「スキャン不可」と
        // 即断すると、普通のWebページなのに誤って弾いてしまう ―― これが
        // 「エラーになる」報告の正体である可能性が高い。
        // url が判明していて、かつ既知の不可パターンに一致する場合のみ、
        // 実際の注入を試みる前に弾く。url が不明な場合は実際にスクリプト注入を
        // 試み、それが失敗したときの本当のエラーから判断する。
        if (url && !isScriptableUrl(url)) {
          debugLog('al_scan_request: unscriptable URL —', url);
          sendResponse({
            ok: false,
            error:
              'AccessLens cannot scan this page. Browser pages (chrome://…), the Chrome Web Store, and the extension’s own pages cannot be scripted by extensions — open a regular website tab and try again.'
          });
          return;
        }

        if (!url) {
          // url が取得できていない場合は、タブ情報を取り直して補完を試みる
          // (取れなくても injectRunnerIfNeeded 側のエラーで適切に判定する)
          try {
            const tabInfo = await chrome.tabs.get(tabId);
            if (tabInfo) {
              if (tabInfo.url) url = tabInfo.url;
              if (tabInfo.title) title = title || tabInfo.title;
            }
          } catch (err) {
            debugLog('al_scan_request: chrome.tabs.get failed —', err.message);
          }
          if (url && !isScriptableUrl(url)) {
            debugLog('al_scan_request: unscriptable URL (resolved late) —', url);
            sendResponse({
              ok: false,
              error:
                'AccessLens cannot scan this page. Browser pages (chrome://…), the Chrome Web Store, and the extension’s own pages cannot be scripted by extensions — open a regular website tab and try again.'
            });
            return;
          }
        }

        let result;
        try {
          result = await scanPage(tabId, url);
        } catch (err) {
          // chrome.scripting.executeScript は、拡張機能がアクセスを許可されていない
          // タブ(activeTab が再付与されていないタブに切り替えた後など)に対して
          // 「Cannot access contents of...」「Cannot access a chrome...」のような
          // 権限エラーを投げる。これを汎用のスキャン失敗ではなく、分かりやすい
          // 案内に変換する。
          const msg = String(err && err.message || '');
          if (/cannot access/i.test(msg) || /chrome:\/\/|extension gallery|cannot be scripted/i.test(msg)) {
            debugLog('al_scan_request: permission/access error —', msg);
            sendResponse({
              ok: false,
              error:
                'AccessLens could not access this tab (the browser may not have granted the extension permission for it yet — this can happen after switching tabs). Click the AccessLens icon in the toolbar again on the tab you want to scan, then try “Scan this page” once more.'
            });
            return;
          }
          throw err;
        }

        debugLog('al_scan_request: success, sending response');
        sendResponse({ ok: true, result, pageUrl: url, pageTitle: title });
      } catch (err) {
        debugLog('al_scan_request: error —', err.message);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // 非同期応答のため true を返す
  }
  if (message.type === 'al_debug_get_log') {
    // E2E テスト/サポート調査用: 直近のスキャン処理ログを取得する
    sendResponse({ log: globalThis.__al_debugLog || [] });
    return false;
  }
  return false;
});
