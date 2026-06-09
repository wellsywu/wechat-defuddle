# wechat-defuddle

> 把微信公众号文章链接转换成干净、结构清晰的 Markdown 文档。

一个 [Claude Code Skill](https://docs.claude.com/en/docs/claude-code/skills)：丢给它一个
`https://mp.weixin.qq.com/s/...` 链接，它用 [Defuddle](https://github.com/kepano/defuddle)
抽取正文，自动剥离微信的 UI chrome，再由模型清除嵌入式广告、还原排版结构，最终产出一篇
纯净的 Markdown。

## 特性

- **两层清理**：脚本负责确定性的机械清理（UI chrome、导航栏、扫码小程序、重复抬头），
  模型负责需要判断的语义清理（软文广告、伪标题还原）。
- **零强制安装**：优先使用全局 `defuddle`，没有则用 `npx -y defuddle` 按需拉起，
  Defuddle 本身永远不需要手动安装。
- **自动命名**：输出文件默认以文章标题命名，完整保留中文与全角标点。
- **元数据 frontmatter**：自动生成 title / author / source / fetched / word_count / cover。
- **自适应**：营销长文做大量结构还原，官方通稿则只做最小清理——不机械套模板。

## 前置条件

- [Node.js](https://nodejs.org)（自带 npm 与 npx）——唯一的硬性依赖。

Defuddle **无需**单独安装。如已全局安装（`npm install -g defuddle`）会优先使用，否则
首次运行时由 `npx` 自动获取并缓存。

## 安装

把本目录放入 Claude Code 的 skills 路径即可（项目级 `.claude/skills/` 或用户级
`~/.claude/skills/`）：

```bash
# 示例：作为用户级技能安装
cp -r wechat-defuddle ~/.claude/skills/
```

技能会在用户粘贴微信文章链接、要求"整理 / 保存 / 转 Markdown / 清理"时自动触发。

## 用法

### 在 Claude Code 中（推荐）

直接把链接发给 Claude：

```
https://mp.weixin.qq.com/s/xxxxxxxx 用 wechat-defuddle 整理这篇文章
```

Claude 会按 `SKILL.md` 的流程执行：验证运行时 → 运行脚本抓取清理 → 语义清理与排版优化。

### 直接运行脚本

```bash
# 验证运行时是否就绪
node scripts/fetch_clean.mjs --check

# 抓取并清理（输出名默认取文章标题）
node scripts/fetch_clean.mjs "https://mp.weixin.qq.com/s/xxxxxxxx"

# 指定输出路径
node scripts/fetch_clean.mjs "https://mp.weixin.qq.com/s/xxxxxxxx" --out article.md
```

脚本输出一段 JSON 摘要（`out` / `title` / `author` / `wordCount` / `image`）。

| 退出码 | 含义 |
|:------:|------|
| `0` | 成功 |
| `1` | Defuddle 返回空内容（链接失效或需 JS 渲染） |
| `2` | 参数错误（缺少 URL） |
| `3` | 运行时缺失（Node.js / npx 不可用），输出含安装命令与提示 |

## 工作原理

```
微信链接
   │
   ├─ Step 0  验证运行时（--check）：全局 defuddle → 否则 npx -y → 否则提示装 Node.js
   │
   ├─ Step 1  脚本（确定性）
   │            • Defuddle 抽取正文 + 元数据
   │            • 剥离固定 chrome：滑动栏 / 扫一扫 / 小程序 / 底部操作栏 / 重复抬头
   │            • 生成 YAML frontmatter，按标题命名
   │
   └─ Step 2  模型（需判断）
                • 删除嵌入式软文：后台回复 / 粉丝福利 / 关注导流 / 二维码 / 互推
                • 还原排版：emoji 伪标题 → 规范 Markdown 标题层级
                • 合并被拆断的段落，保留正文与配图
```

机械的、100% 安全的清理交给脚本；模糊的、需要语义判断的清理交给模型——这是本技能的核心
设计。详见 [`references/wechat-noise.md`](references/wechat-noise.md)。

## 目录结构

```
wechat-defuddle/
├── SKILL.md                   # 技能指令（触发描述 + 三步工作流）
├── README.md                  # 本文档
├── scripts/
│   └── fetch_clean.mjs        # 抓取 + 剥离 chrome + 生成 frontmatter
└── references/
    └── wechat-noise.md        # 软文识别与排版还原规则参考
```

## 输出格式

```markdown
---
title: "文章标题"
author: "公众号名"
source: "https://mp.weixin.qq.com/s/..."
fetched: "2026-06-09"
site: "微信公众平台"
word_count: 1967
cover: "https://mmbiz.qpic.cn/..."
---

# 文章标题

正文（已去除广告、还原标题层级，保留配图与数据来源）...
```

## 致谢

- [Defuddle](https://github.com/kepano/defuddle) —— 正文抽取引擎。

## 许可证

本项目采用 [MIT](LICENSE) 许可证。
