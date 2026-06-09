#!/usr/bin/env node
/**
 * Creates all 150 Stellar Wave GitHub issues from WAVE_ISSUES.md.
 *
 * Prerequisites:
 *   1. Install GitHub CLI:  winget install GitHub.cli
 *   2. Authenticate:        gh auth login
 *   3. Run this script:     node .github/create-wave-issues.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- helpers ----------

function gh(...args) {
  const result = spawnSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (result.error) {
    console.error(`  spawn error: ${result.error.message}`);
    return null;
  }

  if (result.status !== 0) {
    console.error(`  exit ${result.status}: ${result.stderr.trim()}`);
    return null;
  }

  return result.stdout.trim();
}

function sleep(ms) {
  // Synchronous sleep — avoids async complexity for a one-shot script.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------- labels ----------

const LABEL_DEFS = [
  ['Stellar Wave',        '7B3FE4', 'Drips Wave Program — opt an issue in by applying this label'],
  ['complexity:trivial',  'C2E0C6', '100 points'],
  ['complexity:medium',   'FBCA04', '150 points'],
  ['complexity:high',     'D93F0B', '200 points'],
  ['area:pulse-core',     '0E8A16', 'Event engine, normalization, watcher routing'],
  ['area:pulse-webhooks', '1D76DB', 'HMAC delivery, retry, SSRF, edge verification'],
  ['area:pulse-notify',   '5319E7', 'React hooks for live events'],
  ['type:bug',            'D73A4A', ''],
  ['type:feature',        'A2EEEF', ''],
  ['type:docs',           '0075CA', ''],
  ['type:test',           'BFE5BF', ''],
  ['type:refactor',       'FEF2C0', ''],
  ['type:perf',           'F9D0C4', ''],
  ['type:security',       'EE0701', ''],
  ['type:dx',             'C5DEF5', ''],
  ['good-first-issue',    '7057FF', 'Trivial scope, well-scoped pattern, safe for newcomers'],
  ['help-wanted',         '008672', 'Open for anyone, not newcomer-gated'],
  ['needs-design',        'E99695', 'Proposal / approach must be agreed before implementation'],
  ['blocked',             '000000', 'Waiting on an upstream issue'],
];

function createLabels() {
  console.log('\n── Creating labels ───────────────────────────────────────');
  for (const [name, color, desc] of LABEL_DEFS) {
    process.stdout.write(`  ${name.padEnd(22)} `);
    const r = gh('label', 'create', name, '--color', color, '--description', desc, '--force');
    console.log(r !== null ? '✓' : '✗ (may already exist — continuing)');
  }
}

// ---------- issue parser ----------

// Major issue number → package area label.
// Only the three published packages have wave-program scope.
const AREA_BY_MAJOR = {
  1: 'area:pulse-core',
  2: 'area:pulse-webhooks',
  3: 'area:pulse-notify',
};

function areaLabel(issueNum) {
  const major = parseInt(issueNum.split('.')[0], 10);
  const label = AREA_BY_MAJOR[major];
  if (!label) {
    console.error(
      `  ⚠ issue ${issueNum}: major number ${major} is not in scope (valid: ${Object.keys(AREA_BY_MAJOR).join(', ')}). No area label applied.`
    );
    return '';
  }
  return label;
}

function parseComplexityLine(line) {
  const labels = [];
  if (/trivial/i.test(line)) labels.push('complexity:trivial');
  else if (/medium/i.test(line)) labels.push('complexity:medium');
  else if (/high/i.test(line))   labels.push('complexity:high');

  // Pull every `label` token from the backtick spans
  const tokens = line.match(/`([^`]+)`/g) ?? [];
  for (const tok of tokens) labels.push(tok.replace(/`/g, ''));

  return labels;
}

function parseIssues(content) {
  const lines  = content.split('\n');
  const issues = [];
  let i = 0;

  while (i < lines.length) {
    const hm = lines[i].match(/^### (\d+\.\d+) — (.+)$/);
    if (!hm) { i++; continue; }

    const num      = hm[1];
    const rawTitle = hm[2].replace(/`/g, '').trim();
    const title    = `${num} — ${rawTitle}`;

    // Collect body lines until next issue heading, major section, or separator
    const bodyLines = [];
    i++;
    while (i < lines.length) {
      const ln = lines[i];
      if (ln.match(/^### \d+\.\d+ — /)) break;
      if (ln.match(/^## /))             break;
      if (ln.trim() === '---')          { i++; break; }
      bodyLines.push(ln);
      i++;
    }

    const body = bodyLines.join('\n').trim();

    // Labels
    const issueLabels = ['Stellar Wave', areaLabel(num)].filter(Boolean);
    const cm = body.match(/\*\*Complexity:\*\*\s+(.+)/);
    if (cm) issueLabels.push(...parseComplexityLine(cm[1]));

    issues.push({ num, title, body, labels: issueLabels });
  }

  return issues;
}

// ---------- main ----------

function main() {
  // Auth check
  console.log('Checking GitHub CLI auth...');
  const login = gh('api', 'user', '--jq', '.login');
  if (!login) {
    console.error('\nNot authenticated. Run:  gh auth login\n');
    process.exit(1);
  }
  console.log(`Authenticated as: ${login}`);

  createLabels();

  const mdPath = path.join(__dirname, 'WAVE_ISSUES.md');
  if (!fs.existsSync(mdPath)) {
    console.error(`\nCannot find ${mdPath}`);
    process.exit(1);
  }

  const issues = parseIssues(fs.readFileSync(mdPath, 'utf-8'));
  console.log(`\n── Creating ${issues.length} issues ──────────────────────────────`);

  let created = 0;
  let failed  = 0;

  for (let idx = 0; idx < issues.length; idx++) {
    const issue = issues[idx];
    const prefix = `[${String(idx + 1).padStart(3)}/${issues.length}]`;
    process.stdout.write(`${prefix} ${issue.title.slice(0, 70).padEnd(70)} `);

    const tmpFile = path.join(os.tmpdir(), `gh-wave-body-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, issue.body, 'utf-8');

    const url = gh(
      'issue', 'create',
      '--title',  issue.title,
      '--body-file', tmpFile,
      '--label',  issue.labels.join(','),
    );

    try { fs.unlinkSync(tmpFile); } catch (_) {}

    if (url) {
      console.log(`✓  ${url}`);
      created++;
    } else {
      console.log('✗  (failed — see error above)');
      failed++;
    }

    // Avoid GitHub API rate limits (5 000 req/hr authenticated = plenty, but
    // be polite with a small pause between writes).
    sleep(400);
  }

  console.log(`\n── Summary ────────────────────────────────────────────────`);
  console.log(`  Created : ${created}`);
  console.log(`  Failed  : ${failed}`);
  console.log(`  Total   : ${issues.length}`);
  if (failed === 0) console.log('\nAll issues created successfully. ✓');
}

main();
