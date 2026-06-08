// jsPDF を使ったホワイトラベルPDFレポート生成（Pro機能）。
// 完全クライアントサイドで動作し、バックエンドへの送信は一切行わない。
// jsPDF は lib/jspdf.umd.min.js としてローカル同梱し、グローバルの window.jspdf.jsPDF を使う。

import { drawCoverPage, drawSummaryPage, drawDetailPages, drawFooters } from './report_template.js';

let jsPdfLoadPromise = null;

function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (jsPdfLoadPromise) return jsPdfLoadPromise;

  jsPdfLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '../lib/jspdf.umd.min.js';
    script.onload = () => {
      if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jsPDF failed to load'));
    };
    script.onerror = () => reject(new Error('jsPDF script failed to load'));
    document.head.appendChild(script);
  });

  return jsPdfLoadPromise;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function generateWhiteLabelPdf({ result, pageUrl, pageTitle, companyName, logoDataUrl, accentColor }) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });

  const auditDate = formatDate(new Date());

  drawCoverPage(doc, {
    companyName,
    logoDataUrl,
    accentColor,
    pageUrl,
    auditDate,
    score: result.summary.score
  });

  drawSummaryPage(doc, { summary: result.summary });
  drawDetailPages(doc, { groups: result.groups });
  drawFooters(doc, companyName);

  const safeName = (pageTitle || pageUrl || 'accessibility-report')
    .replace(/[^a-z0-9-_]+/gi, '-')
    .toLowerCase()
    .slice(0, 60);

  doc.save(`${safeName}-a11y-audit-${auditDate}.pdf`);
}

export { generateWhiteLabelPdf };
