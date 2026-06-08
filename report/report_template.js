// レポートのレイアウト定義。pdf_generator.js から呼び出される純粋なレイアウト関数群。
// jsPDF インスタンス (doc) に対して描画するだけで、生成・保存ロジックは持たない。

const PAGE_WIDTH = 210; // A4 mm
const MARGIN = 16;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const IMPACT_COLORS = {
  critical: '#DC2626',
  serious: '#EA580C',
  moderate: '#CA8A04',
  minor: '#65A30D'
};

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function drawCoverPage(doc, { companyName, logoDataUrl, accentColor, pageUrl, auditDate, score }) {
  const [r, g, b] = hexToRgb(accentColor || '#2563EB');

  doc.setFillColor(r, g, b);
  doc.rect(0, 0, PAGE_WIDTH, 60, 'F');

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', MARGIN, 14, 32, 32);
    } catch (err) {
      // 不正な画像データは無視してテキストのみ表示する
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text(companyName || 'Accessibility Audit Report', logoDataUrl ? MARGIN + 40 : MARGIN, 32);

  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.text('WCAG 2.1 Accessibility Audit', logoDataUrl ? MARGIN + 40 : MARGIN, 42);

  doc.setTextColor(31, 41, 55);
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.text('Audit Summary', MARGIN, 80);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(11);
  const lines = [
    `Audited URL: ${pageUrl}`,
    `Audit date: ${auditDate}`,
    `WCAG compliance score: ${score}%`
  ];
  lines.forEach((line, i) => {
    doc.text(line, MARGIN, 92 + i * 8);
  });

  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(
    'Generated with AccessLens — automated checks cover a portion of WCAG success criteria.',
    MARGIN,
    280,
    { maxWidth: CONTENT_WIDTH }
  );
}

function drawSummaryPage(doc, { summary }) {
  doc.addPage();
  let y = MARGIN;

  doc.setTextColor(31, 41, 55);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('Summary', MARGIN, y);
  y += 12;

  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.text(`Total violations found: ${summary.totalViolations}`, MARGIN, y);
  y += 8;
  doc.text(`Estimated WCAG compliance score: ${summary.score}%`, MARGIN, y);
  y += 12;

  doc.setFont(undefined, 'bold');
  doc.text('Violations by severity', MARGIN, y);
  y += 8;
  doc.setFont(undefined, 'normal');

  for (const [impact, count] of Object.entries(summary.impactCounts)) {
    const [r, g, b] = hexToRgb(IMPACT_COLORS[impact]);
    doc.setFillColor(r, g, b);
    doc.circle(MARGIN + 2, y - 1.5, 1.8, 'F');
    doc.setTextColor(31, 41, 55);
    doc.text(`${capitalize(impact)}: ${count}`, MARGIN + 8, y);
    y += 7;
  }

  return y;
}

function drawDetailPages(doc, { groups }) {
  doc.addPage();
  let y = MARGIN;

  doc.setTextColor(31, 41, 55);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('Detailed Findings by WCAG Criterion', MARGIN, y);
  y += 12;

  for (const group of groups) {
    if (y > 260) {
      doc.addPage();
      y = MARGIN;
    }

    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(`${group.criterion.id} — ${group.criterion.name} (Level ${group.criterion.level})`, MARGIN, y);
    y += 8;

    for (const violation of group.violations) {
      if (y > 265) {
        doc.addPage();
        y = MARGIN;
      }

      const [r, g, b] = hexToRgb(IMPACT_COLORS[violation.impact] || '#6B7280');
      doc.setFillColor(r, g, b);
      doc.roundedRect(MARGIN, y - 4, 22, 6, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont(undefined, 'bold');
      doc.text(violation.impact.toUpperCase(), MARGIN + 11, y, { align: 'center' });

      doc.setTextColor(31, 41, 55);
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text(violation.help, MARGIN + 26, y, { maxWidth: CONTENT_WIDTH - 26 });
      y += 6;

      doc.setFont(undefined, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(75, 85, 99);
      const descLines = doc.splitTextToSize(violation.description, CONTENT_WIDTH - 4);
      doc.text(descLines, MARGIN + 2, y);
      y += descLines.length * 4.5 + 2;

      const sample = violation.nodes[0];
      if (sample) {
        doc.setFont('courier', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(31, 41, 55);
        const selectorLines = doc.splitTextToSize(`Selector: ${sample.selector}`, CONTENT_WIDTH - 4);
        doc.text(selectorLines, MARGIN + 2, y);
        y += selectorLines.length * 4 + 2;

        if (sample.failureSummary) {
          doc.setFont(undefined, 'italic');
          doc.setFontSize(8.5);
          doc.setTextColor(75, 85, 99);
          const fixLines = doc.splitTextToSize(`Fix guidance: ${sample.failureSummary}`, CONTENT_WIDTH - 4);
          doc.text(fixLines, MARGIN + 2, y);
          y += fixLines.length * 4 + 2;
        }
      }

      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(37, 99, 235);
      doc.textWithLink('Reference: ' + violation.helpUrl, MARGIN + 2, y, { url: violation.helpUrl });
      y += 8;
    }

    y += 4;
  }
}

function drawFooters(doc, companyName) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text(companyName || 'AccessLens', MARGIN, 292);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_WIDTH - MARGIN, 292, { align: 'right' });
  }
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export { drawCoverPage, drawSummaryPage, drawDetailPages, drawFooters };
