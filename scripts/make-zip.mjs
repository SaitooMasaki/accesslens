// Chrome Web Store 申請用 ZIP を作成するスクリプト
// 拡張機能の実行に必要なファイルだけを含め、開発用ファイル(e2e/scripts/node_modules等)は除外する
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '..');
const out = path.resolve(src, '..', 'accesslens-store.zip');

// 含めるファイル/ディレクトリ（拡張機能の実行に必要なもののみ）
const includes = [
  'manifest.json',
  'background.js',
  '_locales',
  'assets',
  'content',
  'lib',
  'licensing',
  'options',
  'panel',
  'popup',
  'pricing',
  'report',
  'storage',
];

// 既存のZIPを削除
if (fs.existsSync(out)) fs.unlinkSync(out);

// PowerShell の Compress-Archive を使用
const paths = includes.map((i) => path.join(src, i));
const pathList = paths.map((p) => p.replace(/\//g, '\\')).join('","');

const psCmd = [
  `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
  `$paths = @("${pathList}")`,
  `Compress-Archive -Path $paths -DestinationPath "${out.replace(/\//g, '\\')}" -Force`,
].join('; ');

console.log('Creating ZIP...');
execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'inherit' });

// 中身と容量を確認
const stat = fs.statSync(out);
console.log(`\nCreated: ${out}`);
console.log(`Size: ${Math.round(stat.size / 1024)} KB\n`);

const listCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $r=[System.IO.Compression.ZipFile]::OpenRead('${out.replace(/\//g, '\\')}'); $r.Entries | ForEach-Object { $_.FullName } | Sort-Object; $r.Dispose()"`;
const listing = execSync(listCmd, { encoding: 'utf8' });
console.log('Contents:\n' + listing);
