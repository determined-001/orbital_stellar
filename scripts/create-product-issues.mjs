#!/usr/bin/env node
/**
 * Creates the product-completion issue backlog on GitHub from issues.md.
 *
 * Successor to .github/create-wave-issues.js. Differences that matter:
 *   - idempotent: existing open/closed issues with the same title are skipped
 *   - creates milestones from the `**Milestone:**` line, not just labels
 *   - area labels come from backtick tokens, so any major number works
 *   - --dry-run prints exactly what would be created without writing anything
 *
 * Prerequisites:
 *   1. GitHub CLI installed and on PATH
 *   2. gh auth login   (the authenticated account needs write on the repo)
 *
 * Usage:
 *   node scripts/create-product-issues.mjs --dry-run
 *   node scripts/create-product-issues.mjs
 *   node scripts/create-product-issues.mjs --wave 8
 *   node scripts/create-product-issues.mjs --only 8.1,8.3,9.4
 *   node scripts/create-product-issues.mjs --file issues.md --repo owner/name
 *
 * Flags:
 *   --dry-run             parse and print; create nothing
 *   --file <path>         source markdown (default: issues.md at repo root)
 *   --repo <owner/name>   target repo (default: gh's current repo)
 *   --wave <n>            only issues whose major number is <n> (repeatable)
 *   --only <a,b,c>        only these issue numbers
 *   --limit <n>           stop after n creations
 *   --no-wave-label       do not apply the "Stellar Wave" label
 *   --force               create even if an issue with the same title exists
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------- cli parsing

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    file: join(REPO_ROOT, "issues.md"),
    repo: null,
    waves: [],
    only: [],
    limit: Infinity,
    waveLabel: true,
    force: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} requires a value`);
      return v;
    };

    switch (arg) {
      case "--dry-run":
      case "-n":
        opts.dryRun = true;
        break;
      case "--file":
        opts.file = resolve(process.cwd(), next());
        break;
      case "--repo":
        opts.repo = next();
        break;
      case "--wave":
        opts.waves.push(next());
        break;
      case "--only":
        opts.only.push(
          ...next()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        break;
      case "--limit":
        opts.limit = Number(next());
        if (!Number.isFinite(opts.limit) || opts.limit < 1)
          fail("--limit must be a positive number");
        break;
      case "--no-wave-label":
        opts.waveLabel = false;
        break;
      case "--force":
        opts.force = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        fail(`unknown flag: ${arg}`);
    }
  }

  return opts;
}

function printHelp() {
  const header = readFileSync(fileURLToPath(import.meta.url), "utf-8")
    .split("\n")
    .slice(2)
    .filter((l) => l.startsWith(" *"))
    .map((l) => l.replace(/^ \* ?/, ""))
    .join("\n");
  console.log(header.replace(/\/$/, "").trim());
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ------------------------------------------------------------------ gh helper

function gh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, { encoding: "utf-8", windowsHide: true });

  if (result.error) {
    if (result.error.code === "ENOENT")
      fail("gh CLI not found on PATH. Install it: https://cli.github.com");
    if (allowFailure) return null;
    fail(`gh spawn failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    if (allowFailure) return null;
    console.error(`  gh exited ${result.status}: ${(result.stderr || "").trim()}`);
    return null;
  }

  return (result.stdout || "").trim();
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// -------------------------------------------------------------------- labels

/** Labels the backlog references. `--force` on create makes this idempotent. */
const LABEL_DEFS = [
  ["Stellar Wave", "7B3FE4", "Drips Wave Program - opt an issue in by applying this label"],
  ["complexity:trivial", "C2E0C6", "100 points"],
  ["complexity:medium", "FBCA04", "150 points"],
  ["complexity:high", "D93F0B", "200 points"],
  ["area:pulse-core", "0E8A16", "Event engine, normalization, watcher routing"],
  ["area:pulse-webhooks", "1D76DB", "HMAC delivery, retry, SSRF, edge verification"],
  ["area:pulse-notify", "5319E7", "React hooks for live events"],
  ["area:abi-registry", "8250DF", "ABI registry client, attestation, verification"],
  ["area:apps-web", "E4E669", "Documentation site and web app (apps/web)"],
  ["area:contracts", "DEA584", "Soroban contracts (contracts/)"],
  ["area:orbital-indexer", "B4A7D6", "Auto-publish indexer"],
  ["area:starters", "FFD8B1", "Starter boilerplates and example apps"],
  ["area:semantic-data", "FEF2C0", "Taxonomy mappings and entity labels (data/)"],
  ["type:bug", "D73A4A", ""],
  ["type:feature", "A2EEEF", ""],
  ["type:docs", "0075CA", ""],
  ["type:test", "BFE5BF", ""],
  ["type:refactor", "FEF2C0", ""],
  ["type:perf", "F9D0C4", ""],
  ["type:security", "EE0701", ""],
  ["type:dx", "C5DEF5", ""],
  ["type:ops", "8B949E", "Deployment, CI, secrets, release mechanics"],
  ["good-first-issue", "7057FF", "Trivial scope, well-scoped pattern, safe for newcomers"],
  ["help-wanted", "008672", "Open for anyone, not newcomer-gated"],
  ["needs-design", "E99695", "Proposal / approach must be agreed before implementation"],
  ["blocked", "000000", "Waiting on an upstream issue"],
  [
    "maintainer-only",
    "5B21B6",
    "Needs repo secrets or a funded account - not for external contributors",
  ],
  ["priority:critical", "B60205", "Blocks the release gate it belongs to"],
];

function ensureLabels(repoArgs, dryRun) {
  console.log("\n-- labels ------------------------------------------------");
  for (const [name, color, desc] of LABEL_DEFS) {
    if (dryRun) {
      console.log(`  would ensure  ${name}`);
      continue;
    }
    process.stdout.write(`  ${name.padEnd(24)}`);
    const r = gh(
      ["label", "create", name, "--color", color, "--description", desc, "--force", ...repoArgs],
      { allowFailure: true },
    );
    console.log(r !== null ? " ok" : " skipped (already exists or no permission)");
  }
}

// ---------------------------------------------------------------- milestones

function existingMilestones(repoArgs, repoSlug) {
  const out = gh(
    [
      "api",
      `repos/${repoSlug}/milestones?state=all&per_page=100`,
      "--jq",
      ".[] | [.title, .number] | @tsv",
    ],
    { allowFailure: true },
  );
  const map = new Map();
  if (!out) return map;
  for (const line of out.split("\n").filter(Boolean)) {
    const [title, number] = line.split("\t");
    map.set(title, Number(number));
  }
  return map;
}

function ensureMilestones(titles, repoSlug, dryRun) {
  console.log("\n-- milestones --------------------------------------------");
  const existing = dryRun ? new Map() : existingMilestones([], repoSlug);

  for (const title of titles) {
    if (existing.has(title)) {
      console.log(`  exists        ${title}`);
      continue;
    }
    if (dryRun) {
      console.log(`  would create  ${title}`);
      continue;
    }
    process.stdout.write(`  creating      ${title}`);
    const r = gh(
      ["api", `repos/${repoSlug}/milestones`, "-f", `title=${title}`, "--jq", ".number"],
      { allowFailure: true },
    );
    console.log(r !== null ? "  ok" : "  failed (continuing without milestone)");
  }
}

// -------------------------------------------------------------------- parser

/** `**Effort:** Medium` -> `complexity:medium`. */
function effortLabel(line) {
  if (/trivial/i.test(line)) return "complexity:trivial";
  if (/medium/i.test(line)) return "complexity:medium";
  if (/high/i.test(line)) return "complexity:high";
  return null;
}

/** Pull every `token` out of a backtick-delimited label line. */
function backtickTokens(line) {
  return (line.match(/`([^`]+)`/g) ?? []).map((t) => t.replace(/`/g, ""));
}

const ISSUE_HEADING = /^###\s+(\d+\.\d+)\s+(.+)$/;

function parseIssues(content) {
  const lines = content.split("\n");
  const issues = [];
  let i = 0;

  while (i < lines.length) {
    const heading = lines[i].match(ISSUE_HEADING);
    if (!heading) {
      i++;
      continue;
    }

    const num = heading[1];
    const title = `${num} ${heading[2].replace(/`/g, "").trim()}`;

    const bodyLines = [];
    i++;
    while (i < lines.length) {
      const ln = lines[i];
      if (ISSUE_HEADING.test(ln)) break;
      if (/^## /.test(ln)) break;
      if (ln.trim() === "---") {
        i++;
        break;
      }
      bodyLines.push(ln);
      i++;
    }

    const body = bodyLines.join("\n").trim();
    const labels = new Set();

    const labelLine = body.match(/\*\*Labels:\*\*\s+(.+)/);
    if (labelLine) for (const l of backtickTokens(labelLine[1])) labels.add(l);

    const effort = body.match(/\*\*Effort:\*\*\s+(.+)/);
    const complexity = effort ? effortLabel(effort[1]) : null;
    if (complexity) labels.add(complexity);

    const milestone = body.match(/\*\*Milestone:\*\*\s+(.+)/);

    const dependsOn = body.match(/\*\*Depends on:\*\*\s+(.+)/);
    const blockedBy =
      dependsOn && !/^none$/i.test(dependsOn[1].trim()) ? dependsOn[1].trim() : null;
    if (blockedBy) labels.add("blocked");

    issues.push({
      num,
      major: Number(num.split(".")[0]),
      title,
      body,
      labels: [...labels],
      milestone: milestone ? milestone[1].trim() : null,
      blockedBy,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------- main

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(opts.file)) fail(`cannot find ${opts.file}`);

  const issues = parseIssues(readFileSync(opts.file, "utf-8"));
  if (issues.length === 0)
    fail(`no issues parsed from ${opts.file} - check the "### N.N - Title" heading format`);

  const selected = issues.filter((issue) => {
    if (opts.only.length && !opts.only.includes(issue.num)) return false;
    if (opts.waves.length && !opts.waves.includes(String(issue.major))) return false;
    return true;
  });

  if (selected.length === 0) fail("selection matched zero issues");

  // Auth + repo resolution.
  let repoSlug = opts.repo;
  if (!opts.dryRun) {
    const login = gh(["api", "user", "--jq", ".login"], { allowFailure: true });
    if (!login) fail("not authenticated - run: gh auth login");
    console.log(`authenticated as: ${login}`);

    if (!repoSlug) {
      repoSlug = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
        allowFailure: true,
      });
      if (!repoSlug) fail("could not resolve the current repo - pass --repo owner/name");
    }
    console.log(`target repo:      ${repoSlug}`);
  } else {
    repoSlug = repoSlug ?? "<current repo>";
  }

  const repoArgs = opts.repo ? ["--repo", opts.repo] : [];

  // Idempotency: build the set of titles that already exist.
  const existingTitles = new Set();
  if (!opts.dryRun && !opts.force) {
    const out = gh(
      [
        "issue",
        "list",
        "--state",
        "all",
        "--limit",
        "1000",
        "--json",
        "title",
        "--jq",
        ".[].title",
        ...repoArgs,
      ],
      { allowFailure: true },
    );
    if (out) for (const t of out.split("\n").filter(Boolean)) existingTitles.add(t.trim());
  }

  ensureLabels(repoArgs, opts.dryRun);

  const milestoneTitles = [...new Set(selected.map((i) => i.milestone).filter(Boolean))];
  if (milestoneTitles.length) {
    if (opts.dryRun) {
      ensureMilestones(milestoneTitles, repoSlug, true);
    } else {
      ensureMilestones(milestoneTitles, repoSlug, false);
    }
  }

  console.log(`\n-- issues (${selected.length} selected) ------------------------------`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let idx = 0; idx < selected.length; idx++) {
    if (created >= opts.limit) {
      console.log(`\n  --limit ${opts.limit} reached, stopping.`);
      break;
    }

    const issue = selected[idx];
    const labels = opts.waveLabel ? ["Stellar Wave", ...issue.labels] : issue.labels;
    const prefix = `[${String(idx + 1).padStart(2)}/${selected.length}]`;

    if (existingTitles.has(issue.title)) {
      console.log(`${prefix} ${issue.title.slice(0, 62).padEnd(62)} skip (exists)`);
      skipped++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`${prefix} ${issue.title}`);
      console.log(`         labels:    ${labels.join(", ")}`);
      console.log(`         milestone: ${issue.milestone ?? "(none)"}`);
      if (issue.blockedBy) console.log(`         blocked by: ${issue.blockedBy}`);
      console.log(`         body:      ${issue.body.split("\n").length} lines`);
      created++;
      continue;
    }

    process.stdout.write(`${prefix} ${issue.title.slice(0, 62).padEnd(62)} `);

    const tmpFile = join(tmpdir(), `orbital-issue-${issue.num}-${process.pid}.md`);
    writeFileSync(tmpFile, issue.body, "utf-8");

    const args = [
      "issue",
      "create",
      "--title",
      issue.title,
      "--body-file",
      tmpFile,
      "--label",
      labels.join(","),
      ...repoArgs,
    ];
    if (issue.milestone) args.push("--milestone", issue.milestone);

    const url = gh(args, { allowFailure: true });

    try {
      unlinkSync(tmpFile);
    } catch {
      /* best effort */
    }

    if (url) {
      console.log(`ok  ${url}`);
      created++;
    } else {
      console.log("FAILED");
      failed++;
    }

    // Be polite to the API between writes.
    sleep(400);
  }

  console.log("\n-- summary -----------------------------------------------");
  console.log(`  parsed   : ${issues.length}`);
  console.log(`  selected : ${selected.length}`);
  console.log(`  ${opts.dryRun ? "would create" : "created "} : ${created}`);
  console.log(`  skipped  : ${skipped}`);
  console.log(`  failed   : ${failed}`);

  if (opts.dryRun)
    console.log("\ndry run - nothing was written. Re-run without --dry-run to create.");
  if (failed > 0) process.exit(1);
}

main();
