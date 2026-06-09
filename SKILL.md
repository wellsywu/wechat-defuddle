---
name: wechat-defuddle
description: >-
  Convert a WeChat public-account article (mp.weixin.qq.com/s/... link) into a
  clean, well-structured Markdown document. Uses the Defuddle library to extract
  the article, a bundled script to strip WeChat's UI chrome, then removes
  embedded promotional content (后台回复/粉丝福利/关注我们/扫码) and restores proper
  heading structure. Use this whenever the user pastes a WeChat/微信公众号 article URL
  and wants it saved, archived, read offline, turned into Markdown/notes, or
  "cleaned up" — even if they don't say "Defuddle" by name.
---

# WeChat Article → Clean Markdown

Turn a WeChat article URL into a pure, well-organized Markdown file. The workflow
splits into a **deterministic script step** (fetch + strip fixed chrome) and a
**model judgment step** (remove embedded ads + restore structure), because WeChat
mixes machine-removable UI junk with fuzzy, human-judgment-required promotional copy.

## When to use

Trigger on any `https://mp.weixin.qq.com/s/...` link where the user wants the
content as a document/notes/Markdown, or wants it "cleaned" / "saved" / "archived".

## Step 0 — Verify the runtime is ready

Defuddle never needs a manual install. The script picks how to run it in two steps:
first it checks for a **global** install (`scope: "global"`, run via the bare
`defuddle` bin — fastest); if there's no global install, it falls back to
`scope: "npx"`, running `npx -y defuddle`, which fetches Defuddle on demand. So the
only hard prerequisite is the Node.js toolchain (which provides npx). Check it first:

```bash
node scripts/fetch_clean.mjs --check
```

- `{"available": true, "scope": "global"|"npx", ...}` (exit 0) → proceed to Step 1.
  `scope: "npx"` means Defuddle will be fetched on the first parse (one-time
  download, then cached). Either scope is fine — no action needed.
- `{"available": false, ...}` (exit 3) → **Node.js/npx is missing.** Do not install
  silently. The output includes `command` (e.g. `winget install OpenJS.NodeJS`) and a
  platform-specific `hint`. Show these to the user, explain Node.js is required, and
  ask permission before installing it. After they approve and you install, re-run
  `--check` to confirm, then continue. (Step 1 preflights this too and refuses with
  the same guidance if the runtime is absent.)

## Step 1 — Fetch and strip chrome (script)

Run the bundled script. It calls Defuddle, removes WeChat's fixed UI chrome
(swipe bars, 扫一扫/小程序 prompts, the bottom action bar, the duplicated account
header, the novel-reader ad), and writes a Markdown file with YAML frontmatter.

```bash
node scripts/fetch_clean.mjs "<url>" --out "<output>.md"
```

- Pass the URL exactly as given. Quote it (WeChat URLs may contain `&`/`?`).
- `--out` is optional; without it the file is named after the article title
  (`<title>.md`), falling back to `wechat-<article-id>.md` if the title is empty.
- The script prints a JSON summary (`out`, `title`, `author`, `wordCount`, `image`).
- If it prints "empty content", the URL is wrong/expired or needs JS rendering —
  tell the user; do not fabricate content.

The script handles only what is 100% safe to automate. It deliberately leaves
embedded promos and heading structure for you — that is Step 2.

## Step 2 — Clean ads and restore structure (you)

Read the file the script produced, then read `references/wechat-noise.md` and apply it.
Two jobs:

1. **Remove embedded promotional copy** that the script can't safely match —
   公众号导流、后台回复、粉丝福利/抽奖、纯引导话术、二维码/名片、课程广告、互推荐读.
   Keep everything that is real article information (including 数据来源/免责声明).
   When unsure, keep it — err toward preserving content over deleting it.

2. **Restore heading structure.** WeChat fakes headings with emoji + bold + rules.
   Convert the real section markers (e.g. `🎯 第一炸…`, `🔮 结语…`) into proper
   Markdown headings (`##`/`###`) that mirror the article's own logical structure.
   Do **not** rewrite, reorder, summarize, or add to the body — only adjust heading
   levels, drop ads, merge mis-split paragraphs, and clean stray emoji/blank lines.

Apply these edits directly to the output `.md` file with Edit/Write.

## Output

A single `.md` file: YAML frontmatter (title/author/source/fetched/word_count/cover)
+ clean body with a sensible heading hierarchy and no WeChat chrome or ads. Tell the
user the file path and give a one-line note of what you removed (chrome + which kinds
of promos) so they can spot-check.

## Notes

- Defuddle command selection: (1) use a global `defuddle` bin if present; (2) else
  `npx -y defuddle`, which fetches it on demand — Defuddle itself never needs manual
  installing. The only prerequisite is the Node.js runtime; if it's missing, Step 0
  reports it and you ask the user's OK before installing Node.js.
- Article images (`mmbiz.qpic.cn` links) are real content — keep them.
- Don't translate or alter the language of the article unless the user asks.
