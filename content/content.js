// 対象ページに axe-core を注入して実行するためのランナー。
// chrome.scripting.executeScript({ files: [...] }) でページに動的注入される
// （content_scripts の静的宣言は使わない）。注入後、background.js が
// window.__al_runScan(url) を呼び出してスキャンを実行・結果を取得する。
//
// このファイルは axe.min.js と scanner.js の後に同じ実行コンテキスト
// （isolated world）へ注入される前提で、両者が定義するグローバルに依存する。

(function () {
  window.__al_runScan = async function (pageUrl) {
    const raw = await window.axe.run(document, {
      resultTypes: ['violations', 'passes', 'incomplete']
    });
    raw.url = pageUrl || window.location.href;
    return window.__al_formatAxeResults(raw);
  };
})();
