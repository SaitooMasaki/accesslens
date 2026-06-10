// SVGロゴ(scripts/icon.svg)を Playwright で各サイズのPNGに書き出す。
// アイコンは「虫眼鏡(レンズ)+ チェックマーク」= 「アクセシビリティ問題を見つけてチェックする」
// というコンセプトのシンプルなベクターデザインなので、サイズごとに描画し直すだけで
// どの解像度でも綺麗に表示できる。
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
const outDir = path.resolve(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 48, 128, 512];

const html = `<!DOCTYPE html><html><head><style>
  * { margin:0; padding:0; }
  html,body { background: transparent; }
  svg { display:block; }
</style></head><body>${svg}</body></html>`;

async function main() {
  const browser = await chromium.launch();
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.evaluate((s) => {
      const svgEl = document.querySelector('svg');
      svgEl.setAttribute('width', String(s));
      svgEl.setAttribute('height', String(s));
    }, size);
    const out = path.join(outDir, `icon${size}.png`);
    await page.screenshot({ path: out, omitBackground: true });
    console.log('Wrote', out);
    await page.close();
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
