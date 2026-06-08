// axe-core の結果を WCAG 基準別にグルーピングし、UI/レポートで使いやすい形に整形する。
// このファイルはページコンテキストに注入され、window.__al_formatAxeResults として公開される。

(function () {
  // axe-core の tags（例: 'wcag111', 'wcag143', 'wcag2aa'）から
  // 人間が読める WCAG 番号・名称を抽出するマップ。
  const WCAG_TAG_MAP = {
    wcag111: { id: '1.1.1', name: 'Non-text Content', level: 'A' },
    wcag121: { id: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)', level: 'A' },
    wcag122: { id: '1.2.2', name: 'Captions (Prerecorded)', level: 'A' },
    wcag123: { id: '1.2.3', name: 'Audio Description or Media Alternative', level: 'A' },
    wcag131: { id: '1.3.1', name: 'Info and Relationships', level: 'A' },
    wcag132: { id: '1.3.2', name: 'Meaningful Sequence', level: 'A' },
    wcag133: { id: '1.3.3', name: 'Sensory Characteristics', level: 'A' },
    wcag141: { id: '1.4.1', name: 'Use of Color', level: 'A' },
    wcag142: { id: '1.4.2', name: 'Audio Control', level: 'A' },
    wcag143: { id: '1.4.3', name: 'Contrast (Minimum)', level: 'AA' },
    wcag144: { id: '1.4.4', name: 'Resize Text', level: 'AA' },
    wcag145: { id: '1.4.5', name: 'Images of Text', level: 'AA' },
    wcag1410: { id: '1.4.10', name: 'Reflow', level: 'AA' },
    wcag1411: { id: '1.4.11', name: 'Non-text Contrast', level: 'AA' },
    wcag1412: { id: '1.4.12', name: 'Text Spacing', level: 'AA' },
    wcag1413: { id: '1.4.13', name: 'Content on Hover or Focus', level: 'AA' },
    wcag211: { id: '2.1.1', name: 'Keyboard', level: 'A' },
    wcag212: { id: '2.1.2', name: 'No Keyboard Trap', level: 'A' },
    wcag221: { id: '2.2.1', name: 'Timing Adjustable', level: 'A' },
    wcag222: { id: '2.2.2', name: 'Pause, Stop, Hide', level: 'A' },
    wcag231: { id: '2.3.1', name: 'Three Flashes or Below Threshold', level: 'A' },
    wcag241: { id: '2.4.1', name: 'Bypass Blocks', level: 'A' },
    wcag242: { id: '2.4.2', name: 'Page Titled', level: 'A' },
    wcag243: { id: '2.4.3', name: 'Focus Order', level: 'A' },
    wcag244: { id: '2.4.4', name: 'Link Purpose (In Context)', level: 'A' },
    wcag245: { id: '2.4.5', name: 'Multiple Ways', level: 'AA' },
    wcag246: { id: '2.4.6', name: 'Headings and Labels', level: 'AA' },
    wcag247: { id: '2.4.7', name: 'Focus Visible', level: 'AA' },
    wcag311: { id: '3.1.1', name: 'Language of Page', level: 'A' },
    wcag312: { id: '3.1.2', name: 'Language of Parts', level: 'AA' },
    wcag321: { id: '3.2.1', name: 'On Focus', level: 'A' },
    wcag322: { id: '3.2.2', name: 'On Input', level: 'A' },
    wcag331: { id: '3.3.1', name: 'Error Identification', level: 'A' },
    wcag332: { id: '3.3.2', name: 'Labels or Instructions', level: 'A' },
    wcag411: { id: '4.1.1', name: 'Parsing', level: 'A' },
    wcag412: { id: '4.1.2', name: 'Name, Role, Value', level: 'A' },
    wcag413: { id: '4.1.3', name: 'Status Messages', level: 'AA' }
  };

  function extractWcagCriterion(tags) {
    for (const tag of tags) {
      if (WCAG_TAG_MAP[tag]) return WCAG_TAG_MAP[tag];
    }
    return { id: 'other', name: 'Other / Best Practice', level: 'A' };
  }

  function formatViolation(violation) {
    const criterion = extractWcagCriterion(violation.tags || []);
    return {
      id: violation.id,
      criterion,
      impact: violation.impact || 'minor',
      description: violation.description,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: (violation.nodes || []).map((node) => ({
        selector: (node.target || []).join(' '),
        html: node.html,
        failureSummary: node.failureSummary
      }))
    };
  }

  function groupByWcagCriterion(formattedViolations) {
    const groups = new Map();
    for (const v of formattedViolations) {
      const key = v.criterion.id;
      if (!groups.has(key)) {
        groups.set(key, { criterion: v.criterion, violations: [] });
      }
      groups.get(key).violations.push(v);
    }
    return Array.from(groups.values()).sort((a, b) => a.criterion.id.localeCompare(b.criterion.id));
  }

  function buildSummary(violations, passes) {
    const impactCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const v of violations) {
      if (impactCounts[v.impact] !== undefined) impactCounts[v.impact] += 1;
    }
    const totalChecks = passes.length + violations.length;
    const score = totalChecks > 0 ? Math.round((passes.length / totalChecks) * 100) : 100;
    return {
      totalViolations: violations.length,
      impactCounts,
      score
    };
  }

  function formatAxeResults(rawResults) {
    const violations = (rawResults.violations || []).map(formatViolation);
    const passes = rawResults.passes || [];
    const incomplete = rawResults.incomplete || [];

    return {
      url: rawResults.url,
      timestamp: rawResults.timestamp,
      summary: buildSummary(violations, passes),
      groups: groupByWcagCriterion(violations),
      violations,
      passesCount: passes.length,
      incompleteCount: incomplete.length
    };
  }

  window.__al_formatAxeResults = formatAxeResults;
})();
