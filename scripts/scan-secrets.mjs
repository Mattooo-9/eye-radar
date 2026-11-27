#!/usr/bin/env node
/**
 * Secret leak scanner for tracked repository files (ACCEPTANCE.md Section 6 / Security).
 * Fails (exit 1) if any hardcoded credential pattern is found in git-tracked files.
 */
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  { name: "Neon/Postgres password URL", re: /postgres(?:ql)?:\/\/[^\s"'`:@/]+:[^\s"'`@]{6,}@/i },
  { name: "Neon password token", re: /npg_[A-Za-z0-9]{8,}/ },
  { name: "Telegram bot token", re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/ },
  { name: "Vercel token", re: /\bvcp_[A-Za-z0-9]{20,}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ }
];

const SKIP = [/^package-lock\.json$/, /\.pmtiles$/, /\.(png|jpe?g|gif|ico|woff2?)$/i, /^scripts\/scan-secrets\.mjs$/];

const files = execSync("git ls-files", { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => !SKIP.some((re) => re.test(f)));

const findings = [];
for (const file of files) {
  try {
    if (statSync(file).size > 2_000_000) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const p of PATTERNS) {
        if (p.re.test(line)) {
          findings.push(`${file}:${idx + 1} — ${p.name}`);
        }
      }
    });
  } catch {}
}

if (findings.length > 0) {
  console.error(`SECRET SCAN FAILED: ${findings.length} potential hardcoded secret(s):`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`SECRET SCAN PASSED: ${files.length} tracked files, 0 hardcoded secrets`);
