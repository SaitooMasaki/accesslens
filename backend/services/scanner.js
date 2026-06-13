import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';
import { logger } from '../logger.js';

// axe-core のブラウザバンドルへのパスを解決する
const require = createRequire(import.meta.url);
const axeCorePath = require.resolve('axe-core');

// Phase 1 の拡張機能と同じルールセットを使い、結果の一貫性を保つ
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

/**
 * 指定 URL をサーバーサイドでスキャンし、axe-core の結果を返す。
 * @param {string} url
 * @returns {Promise<{ violationsCount: number, criticalCount: number, seriousCount: number, resultJson: object }>}
 */
export async function scanUrl(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      // Railway など Linux コンテナでは PUPPETEER_EXECUTABLE_PATH でシステム Chromium を指定できる
      ...(process.env.PUPPETEER_EXECUTABLE_PATH && {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      }),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();

    // タイムアウト付きでページを開く
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // axe-core をページに注入して実行
    await page.addScriptTag({ path: axeCorePath });
    const results = await page.evaluate((tags) => {
      return window.axe.run(document, {
        runOnly: { type: 'tag', values: tags },
      });
    }, AXE_TAGS);

    const violations = results.violations ?? [];
    return {
      violationsCount: violations.length,
      criticalCount: violations.filter((v) => v.impact === 'critical').length,
      seriousCount: violations.filter((v) => v.impact === 'serious').length,
      resultJson: results,
    };
  } finally {
    if (browser) await browser.close();
  }
}
