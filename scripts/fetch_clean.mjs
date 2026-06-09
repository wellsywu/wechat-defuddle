#!/usr/bin/env node
/**
 * fetch_clean.mjs — Fetch a WeChat (mp.weixin.qq.com) article with Defuddle,
 * strip the deterministic WeChat UI chrome, and emit a Markdown file with
 * YAML frontmatter.
 *
 * This handles ONLY the mechanical parts that are 100% safe to automate:
 *   - running Defuddle
 *   - removing WeChat's fixed navigation/footer chrome (swipe bars, mini-program
 *     scan prompts, the bottom action bar, the duplicated account-name header)
 *   - building frontmatter from Defuddle's metadata
 *
 * It intentionally does NOT try to remove embedded promotional copy (后台回复 /
 * 粉丝福利 / 关注我们 / 扫码) or fix heading structure — those need judgment and
 * are done by the model afterwards (see SKILL.md + references/wechat-noise.md).
 *
 * Usage:
 *   node fetch_clean.mjs <url-or-html-file> [--out <path>]
 *
 * Output: writes the Markdown file (named after the article title by default)
 * and prints a JSON summary to stdout:
 *   { "out": "...", "title": "...", "author": "...", "wordCount": 123, "image": "..." }
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const args = { source: null, out: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (a === "--check") args.check = true;
    else if (!args.source) args.source = a;
  }
  return args;
}

// The npm package that provides the `defuddle` CLI (its bin is `defuddle`).
const DEFUDDLE_PKG = "defuddle";

// Probe `<invoke> --version` and return the trimmed version string, or null if
// that invocation can't reach Defuddle. Fast and unambiguous — no parsing.
function probeVersion(invoke) {
  try {
    return execSync(`${invoke} --version`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60000,
    }).trim();
  } catch {
    return null;
  }
}

// Is npx reachable? npx ships with npm/Node, so this also tells us whether the
// Node toolchain is present at all. Just check the exit code — no output needed.
function hasNpx() {
  try {
    execSync("npx --version", {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 60000,
    });
    return true;
  } catch {
    return false;
  }
}

// Resolve how to run Defuddle. Defuddle is NEVER a required manual install:
//   1. If a GLOBAL `defuddle` is on PATH (from `npm install -g`), call it
//      directly — fastest, no npx overhead.
//   2. Otherwise run via `npx -y defuddle`, which fetches it on demand (cached
//      after first use). `-y` auto-confirms so it never hangs non-interactively.
//   3. The only hard prerequisite is the Node toolchain (npx). If npx is absent,
//      Defuddle can't run and the user must install Node.js.
// Returns { available, scope: "global"|"npx"|null, invoke, version }.
function resolveDefuddle() {
  const globalV = probeVersion(DEFUDDLE_PKG);
  if (globalV) {
    return { available: true, scope: "global", invoke: DEFUDDLE_PKG, version: globalV };
  }
  if (hasNpx()) {
    // Don't probe the version here — that would force an on-demand download just
    // to answer a check. The real parse will fetch it (once) if needed.
    return { available: true, scope: "npx", invoke: `npx -y ${DEFUDDLE_PKG}`, version: null };
  }
  return { available: false, scope: null, invoke: null, version: null };
}

// OS-tailored guidance for the missing PREREQUISITE — Node.js, which bundles
// npm and npx. Defuddle itself is fetched on demand by npx, so it's never part
// of this guidance; only the underlying runtime is.
function nodeGuidance() {
  const platform = process.platform;
  let command, hint;
  if (platform === "win32") {
    command = "winget install OpenJS.NodeJS";
    hint = "Windows: or download the installer from https://nodejs.org. Node.js bundles npm and npx.";
  } else if (platform === "darwin") {
    command = "brew install node";
    hint = "macOS: or download from https://nodejs.org. Node.js bundles npm and npx.";
  } else {
    command = "apt install nodejs npm";
    hint = "Linux: or use `dnf install nodejs` / nvm. Node.js bundles npm and npx.";
  }
  return { command, platform, hint };
}

// Run Defuddle's CLI and return its parsed JSON (metadata + contentMarkdown).
// `invoke` is the resolved command prefix from resolveDefuddle() — either the
// global `defuddle` bin or `npx -y defuddle` (fetched on demand).
function runDefuddle(source, invoke) {
  // -j gives metadata AND `contentMarkdown` in a single fetch. Use a shell
  // (execSync) so this works with Windows' .cmd shims; quote the source to
  // survive URLs with query strings (& ? =).
  const q = '"' + String(source).split('"').join('\\"') + '"';
  const out = execSync(`${invoke} parse ${q} -j`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
}

// Exact-match lines that are always WeChat chrome, never article content.
const JUNK_EXACT = new Set([
  "继续滑动看下一个",
  "向上滑动看下一个",
  "微信扫一扫",
  "使用小程序",
  "在小说阅读器读本章",
  "去阅读",
  "预览时标签不可点",
]);

// The bottom action bar renders as a line peppered with these tokens.
const ACTIONBAR_HINTS = ["轻点两下取消赞", "轻点两下取消在看"];

function isActionBar(line) {
  return ACTIONBAR_HINTS.some((h) => line.includes(h));
}

function cleanChrome(markdown, author) {
  let lines = markdown.split(/\r?\n/);

  // 1) Cut everything from WeChat's "swipe to next article" footer onward —
  //    a reliable boundary: nothing below it is ever article content.
  const cut = lines.findIndex((l) => l.trim() === "继续滑动看下一个");
  if (cut !== -1) lines = lines.slice(0, cut);

  // 2) Drop fixed chrome lines anywhere in the body.
  lines = lines.filter((l) => {
    const t = l.trim();
    if (JUNK_EXACT.has(t)) return false;
    if (isActionBar(t)) return false;
    return true;
  });

  // 3) Strip the leading account-name header. Defuddle often emits the account
  //    name once or duplicated ("极客表格指南 极客表格指南") before the title.
  while (lines.length) {
    const t = lines[0].trim();
    if (t === "") { lines.shift(); continue; }
    const tokens = t.split(/\s+/);
    const isAccountHeader =
      author && tokens.length > 0 && tokens.every((tok) => tok === author);
    if (isAccountHeader) { lines.shift(); continue; }
    break;
  }

  // 4) Collapse 3+ blank lines into one, and trim outer whitespace.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function yamlEscape(s) {
  return String(s == null ? "" : s).split('"').join('\\"');
}

function buildFrontmatter(meta, source) {
  const today = new Date().toISOString().slice(0, 10);
  const fm = [
    "---",
    `title: "${yamlEscape(meta.title)}"`,
    `author: "${yamlEscape(meta.author)}"`,
    `source: "${yamlEscape(source)}"`,
    meta.published ? `published: "${yamlEscape(meta.published)}"` : null,
    `fetched: "${today}"`,
    `site: "${yamlEscape(meta.site)}"`,
    `word_count: ${Number(meta.wordCount) || 0}`,
    meta.image ? `cover: "${yamlEscape(meta.image)}"` : null,
    "---",
  ].filter(Boolean);
  return fm.join("\n");
}

// Make a string safe as a filename: drop the characters Windows/macOS/Linux
// forbid plus control chars. Fullwidth punctuation common in Chinese titles
// (： 、 ， ！) is left intact — it's valid in filenames and keeps the name
// faithful to the article. Spaces are legal, so they're kept.
const FORBIDDEN_FILENAME_CHARS = new Set([
  "\\", "/", ":", "*", "?", '"', "<", ">", "|",
]);

function sanitizeFilename(name) {
  const kept = [];
  for (const ch of String(name || "")) {
    if (FORBIDDEN_FILENAME_CHARS.has(ch)) continue;
    if (ch.charCodeAt(0) < 0x20) continue; // control chars
    kept.push(ch);
  }
  return kept
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 120)
    .trim();
}

function deriveOutPath(source, out, title) {
  if (out) return resolve(out);
  // Default the filename to the article title so the file is self-describing.
  const fromTitle = sanitizeFilename(title);
  if (fromTitle) return resolve(`${fromTitle}.md`);
  // Fall back to the WeChat article id if the title is missing/empty.
  const m = /\/s\/([A-Za-z0-9_-]+)/.exec(source || "");
  return resolve(`wechat-${m ? m[1] : "article"}.md`);
}

function main() {
  const { source, out, check } = parseArgs(process.argv.slice(2));

  // `--check`: report how Defuddle will run (global bin vs npx-on-demand), or —
  // if the Node toolchain is missing — how to install it. JSON + exit, no work.
  if (check) {
    const status = resolveDefuddle();
    const payload = status.available
      ? status
      : { ...status, ...nodeGuidance() };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(status.available ? 0 : 3);
  }

  if (!source) {
    console.error("Usage: node fetch_clean.mjs <url-or-html-file> [--out <path>]");
    console.error("       node fetch_clean.mjs --check   (verify the runtime is ready)");
    process.exit(2);
  }

  // Preflight: Defuddle runs from a global install or via npx-on-demand, so the
  // only thing that can be truly missing is the Node toolchain. Fail fast with a
  // Node.js install command instead of a cryptic error.
  const status = resolveDefuddle();
  if (!status.available) {
    const g = nodeGuidance();
    console.error(
      `Node.js / npx not found — it's required to run Defuddle.\nInstall Node.js with:\n  ${g.command}\n${g.hint}`
    );
    process.exit(3);
  }

  const data = runDefuddle(source, status.invoke);
  const markdown = data.contentMarkdown || data.content || "";
  if (!markdown.trim()) {
    console.error("Defuddle returned empty content. The page may need JS rendering or the URL is wrong.");
    process.exit(1);
  }

  const cleaned = cleanChrome(markdown, data.author);
  const frontmatter = buildFrontmatter(data, source);
  const outPath = deriveOutPath(source, out, data.title);

  writeFileSync(outPath, `${frontmatter}\n\n${cleaned}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        out: outPath,
        title: data.title,
        author: data.author,
        wordCount: data.wordCount,
        image: data.image,
      },
      null,
      2
    )
  );
}

main();
