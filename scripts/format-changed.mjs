#!/usr/bin/env node
/**
 * Formats only the package files changed in the working tree
 * (staged + unstaged + untracked) — not the whole codebase.
 *
 * Use `pnpm format:all` for a full pass (rarely needed after the first one).
 */
import { execSync } from "node:child_process";

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8" });
  } catch {
    return "";
  }
}

// Tracked changes (staged + unstaged) vs HEAD, plus new untracked files.
const tracked = git("diff --name-only --diff-filter=ACMR HEAD");
const untracked = git("ls-files --others --exclude-standard");

const files = [...new Set([...tracked.split("\n"), ...untracked.split("\n")])]
  .map((f) => f.trim())
  .filter((f) => /^packages\/.*\.(ts|tsx|json)$/.test(f));

if (files.length === 0) {
  console.log("format: no changed package files.");
  process.exit(0);
}

console.log(`format: ${files.length} changed file(s)`);
execSync(`pnpm exec prettier --write ${files.map((f) => JSON.stringify(f)).join(" ")}`, {
  stdio: "inherit",
});
