# Tampermonkey Base

**一个油猴客户端 + 一个 Supabase 注册中心，装一次脚本，动态发现并加载你名下所有仓库里的站点插件。**

<p>
  <a href="https://cdn.jsdelivr.net/gh/ultralan/tampermonkey-base@published/client/tampermonkey-base.user.js" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;">一键安装客户端</a>
</p>

Tampermonkey Base 把"油猴脚本"拆成了微服务架构：客户端是薄加载器，插件住在各自独立的 Git 仓库里，Supabase 一张表充当注册中心。插件仓库推送代码 → Actions 发布产物并**自注册** → 你的浏览器下一次刷新页面就自动用上新版本。新增一个站点插件，客户端**零改动、零重装**。

## 安装

1. 浏览器装好 [Tampermonkey](https://www.tampermonkey.net/) 扩展；
2. 点击上方"一键安装客户端"，Tampermonkey 会弹出安装确认；
3. 完成。之后所有插件按你访问的网站自动加载，无需任何手动操作。

客户端本体几乎不变，插件代码每次页面加载都按注册中心拉取最新版。

## 端点

系统由三类端点组成：

### 1. 客户端产物（jsDelivr，公开）

| 端点 | 用途 |
|---|---|
| `https://cdn.jsdelivr.net/gh/ultralan/tampermonkey-base@published/client/tampermonkey-base.user.js` | 客户端安装 / 自动更新入口（`@published` 分支由 CI 维护） |
| `https://cdn.jsdelivr.net/gh/<owner>/<plugin-repo>@published/plugin.user.js` | 插件脚本（每个插件仓各自发布） |

### 2. 注册中心与数据（Supabase PostgREST，schema `tampermonkey_base`）

| 端点 | 方法 | 权限 | 用途 |
|---|---|---|---|
| `/rest/v1/plugins` | GET | anon（仅 `enabled=true`） | 客户端启动时发现插件 |
| `/rest/v1/plugins` | POST | service role | 插件仓 CI 发布时自注册（`Prefer: resolution=merge-duplicates`） |
| `/rest/v1/client_logs` | POST | anon | 客户端与插件运行日志 |
| `/rest/v1/builds` | POST | service role | 各仓 CI 写入构建记录 |
| `/rest/v1/<插件业务表>` | 由插件仓 migration 自行定义 | | 插件采集的业务数据 |

请求约定：schema 访问一律带 `Accept-Profile: tampermonkey_base`（读）/ `Content-Profile: tampermonkey_base`（写），认证用 Supabase publishable key（anon）或 service role key。

### 3. 缓存刷新（jsDelivr Purge API，公开）

`https://purge.jsdelivr.net/gh/<owner>/<repo>@published/<path>` —— CI 每次发布后调用，清除分支引用的边缘缓存，否则新脚本可能延迟数小时才全球生效。

## 插件接入

一个插件 = 一个 Git 仓库，最小结构：

```
tampermonkey-plugin-<id>/
  plugin.json            # 插件元数据
  plugin.user.js         # 插件代码
  .github/workflows/publish.yml   # 发布 + 自注册（可从任意现有插件仓复制）
  supabase/migrations/   # 可选：业务表 DDL
```

### plugin.json

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "description": "一句话描述",
  "matches": ["*://example.com/*", "*://*.example.com/*"]
}
```

`matches` 使用 Tampermonkey 的 [match pattern](https://www.tampermonkey.net/documentation.php#_match) 语法，客户端据此决定在哪些页面加载插件。

### 插件代码

插件被包在函数里执行，通过 `TM` 参数拿到客户端注入的 API：

```js
(function (TM) {
  "use strict";

  TM.log("info", "my_plugin_boot", { url: location.href });

  // 写业务表（自动带 Supabase 认证与 schema 头）
  TM.rest("my_table", {
    method: "POST",
    payload: { id: "row-1", value: 42 },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
})(TM);
```

#### TM API 参考

| API | 说明 |
|---|---|
| `TM.log(level, event, data)` | 写运行日志（本地缓存 + `client_logs` 表 + console） |
| `TM.rest(path, { method, payload, prefer, timeout })` | 访问 `tampermonkey_base` schema 的任意 PostgREST 端点 |
| `TM.getValue(key, fallback)` / `TM.setValue(key, value)` | 插件级持久化存储（按插件 id 隔离） |
| `TM.setClipboard(text)` | 写剪贴板 |
| `TM.registerMenuCommand(name, handler)` | 注册油猴菜单项（自动带插件名前缀） |
| `TM.unregisterMenuCommand(id)` | 注销菜单项 |
| `TM.postJson(url, payload, timeout)` | 任意跨域 POST JSON |
| `TM.page()` | 当前页面快照（href/title/readyState 等） |
| `TM.client` | 客户端信息（name/version/sessionId） |
| `TM.plugin` | 本插件在注册中心的元数据 |

### 发布流程

1. 在插件仓 Settings → Secrets → Actions 配置 `TMB_SUPABASE_SERVICE_ROLE_KEY`（Supabase Dashboard → Settings → API Keys 获取）；
2. 推送 `main`，workflow 自动执行：
   1. 把 `plugin.user.js` 发布到本仓 `published` 分支（触发 jsDelivr 可访问）；
   2. purge jsDelivr 边缘缓存；
   3. 读取 `plugin.json` + 计算脚本 sha256，upsert 注册表。
3. 完成。客户端下一次刷新即自动加载（sha256 校验通过才执行）。

**回滚**：`git revert` 后重新推送即可，注册表会更新为旧版本的 hash。
**下线**：在 Supabase 面板把该插件 `plugins.enabled` 翻成 `false`（发布流程不会改动这个开关），或删除注册行。

### 业务表

插件自己的数据表放 `tampermonkey_base` schema，migration 跟插件仓走。参考 [tampermonkey-plugin-mianshiya](https://github.com/ultralan/tampermonkey-plugin-mianshiya) 的 `supabase/migrations/`。注意两个坑：

- 站点 ID 若是长数字（>15 位），**必须用 `text` 列并在插件里保持字符串**，JS Number 精度只有 2^53；
- PostgREST 的 upsert（`resolution=merge-duplicates`）需要 anon 同时具备表的 `select + insert + update` 三种权限。

## 安全模型

客户端会执行注册表驱动的任意 JS，因此有三层防线：

1. **域白名单**：`script_url` 必须匹配 jsDelivr 上 `ultralan` 名下的仓库，注册表被投毒也无法加载外部脚本；
2. **sha256 校验**：脚本内容必须与注册表记录的 hash 一致才执行；
3. **RLS 最小权限**：注册表 anon 只读 `enabled=true`，写入仅 service role（CI 持有）；anon 对公共表只有插入权限。

## 架构

```
基座仓 ultralan/tampermonkey-base              插件仓 ultralan/tampermonkey-plugin-*
  client/tampermonkey-base.user.js               plugin.json + plugin.user.js
  scripts/ 构建验证 + supabase/ 公共表            .github/workflows/publish.yml
        │                                              │ push → Actions
        │ anon 查询注册中心                             │ ① plugin.user.js 发到本仓 published 分支
        ▼                                              │ ② purge jsDelivr + sha256 + upsert 注册表
Supabase tampermonkey_base schema  ◄───────────────────┘
  plugins（注册中心）/ client_logs / builds
  （各插件的业务表由插件仓自带 migration 维护）
```

## 本地开发

```bash
pnpm install --lockfile-only
pnpm run check    # build + verify，验证占位符替换与链路完整性
```

## Supabase 初始化（一次性）

1. SQL Editor 执行 `supabase/migrations/002_federated.sql`（schema + 注册中心 + 公共表）；
2. Dashboard → Settings → API → **Exposed schemas** 添加 `tampermonkey_base`（PostgREST 默认只暴露 public，必须手动）；
3. 注意：新 schema 需要显式 `grant usage ... to service_role`，migration 已包含；
4. 验证链路：

```bash
TMB_SUPABASE_URL=你的项目URL \
TMB_SUPABASE_ANON_KEY=你的publishable key \
pnpm run probe-supabase
```

## 环境变量

| 变量 | 用在哪 | 说明 |
|---|---|---|
| `TMB_PUBLIC_BASE_URL` | CI build | 客户端发布根地址，默认 jsDelivr `@published` |
| `TMB_SUPABASE_URL` | CI / 客户端注入 | Supabase 项目 URL |
| `TMB_SUPABASE_ANON_KEY` | CI / 客户端注入 | publishable key，注册中心查询 + 日志写入 |
| `TMB_SUPABASE_SERVICE_ROLE_KEY` | CI secret | 注册表写入 + 构建记录 |

## 已知限制

- jsDelivr 分支引用的边缘缓存全球同步存在分钟级窗口，急速连续发版时个别地区可能短暂拿到旧脚本（hash 校验会拒绝执行，安全但本轮不生效）；
- 注册中心不可达时客户端回退到本地缓存的插件列表，直到恢复；
- 客户端本体更新依赖 Tampermonkey 的版本检查（`0.1.<run number>` 单调递增）。
