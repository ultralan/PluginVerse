# PluginVerse C/S 架构重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做成一个单入口油猴客户端，按站点动态加载多个插件实现；日志直接写入 Supabase；GitHub Actions 只负责构建与发布静态产物。

**Architecture:** `client/` 只负责清单拉取、插件选择、脚本加载、运行态日志上报；`server/plugins/` 只放各站点插件实现与元数据；`supabase/` 存日志和构建记录。GitHub Pages 承载发布产物，GitHub Actions 负责生成 `manifest.json`、打包脚本和部署静态文件。

**Tech Stack:** JavaScript、Tampermonkey API、Node.js 内置模块、GitHub Actions、GitHub Pages、Supabase SQL

---

### Task 1: 建立工程骨架和构建脚本

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `scripts/build.mjs`
- Create: `scripts/verify.mjs`
- Create: `client/pluginverse.user.js`
- Create: `server/plugins/mianshiya/plugin.json`
- Create: `server/plugins/mianshiya/plugin.user.js`

- [x] **Step 1: 写出客户端入口和插件元数据文件**
- [x] **Step 2: 写出构建脚本，生成 `dist/manifest.json` 和发布产物**
- [x] **Step 3: 写出验证脚本，检查生成文件、哈希和占位符替换**
- [x] **Step 4: 写出 README，说明安装、更新和日志流向**

### Task 2: 落 Supabase 数据模型

**Files:**
- Create: `supabase/migrations/001_init.sql`

- [x] **Step 1: 建立 `pluginverse_builds` 和 `pluginverse_logs` 表**
- [x] **Step 2: 为日志表配置插入策略和必要索引**
- [x] **Step 3: 为构建记录保留服务端写入能力**

### Task 3: 接 GitHub Actions 发布链路

**Files:**
- Create: `.github/workflows/publish.yml`

- [x] **Step 1: 配置 Node 构建和静态产物输出**
- [x] **Step 2: 配置 GitHub Pages 部署**
- [x] **Step 3: 在构建产物里注入发布 URL、Supabase 配置和版本号**

### Task 4: 收口验证

**Files:**
- Modify: `README.md`

- [x] **Step 1: 运行构建脚本，生成 `dist/`**
- [x] **Step 2: 运行验证脚本，确认 manifest、脚本哈希和引用一致**
- [x] **Step 3: 复查说明文档，确保没有把本地 server 当运行时依赖**
