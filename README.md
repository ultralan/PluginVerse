# Tampermonkey Base

Tampermonkey Base 是一个油猴插件基座：**一个客户端 + Supabase 注册中心 + 任意数量的独立插件仓库**，微服务式的动态注册与发现。

<p>
  <a href="https://fastly.jsdelivr.net/gh/ultralan/tampermonkey-base@published/client/tampermonkey-base.user.js" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;">一键安装客户端</a>
</p>

## 架构

```
基座仓 ultralan/tampermonkey-base              插件仓 ultralan/tampermonkey-plugin-*
  client/tampermonkey-base.user.js               plugin.json + plugin.user.js
  scripts/ 构建验证 + supabase/ 公共表            .github/workflows/publish.yml
        │                                              │ push → Actions
        │ anon 查询注册中心                             │ ① plugin.user.js 发到本仓 published 分支
        ▼                                              │ ② sha256 + service key upsert 注册表
Supabase tampermonkey_base schema  ◄───────────────────┘
  plugins（注册中心）/ client_logs / builds
  （各插件的业务表由插件仓自带 migration 维护）
```

- **插件发布 = 自注册**：插件仓推送 `main` 后，Actions 发布产物并 upsert `tampermonkey_base.plugins` 注册表
- **客户端动态发现**：每次页面加载时查询注册中心（失败回退 GM 缓存），按 `matches` 匹配当前站点，拉取插件脚本并校验 sha256 后执行
- **新增插件仓零基座改动**：基座客户端下一次刷新自动发现新插件
- **供应链防护**：客户端只执行 jsDelivr 上 `ultralan` 名下仓库的脚本，注册表驱动 + 域白名单 + hash 校验三重把关

## 目录结构

- `client/`：基座客户端（唯一需要安装的油猴脚本）
- `scripts/`：构建、验证、Supabase 探测与构建记录脚本
- `supabase/migrations/`：公共表（注册中心、日志、构建记录）的初始化 SQL
- `.github/workflows/`：构建客户端并发布到 `published` 分支

## 本地构建

```bash
pnpm install --lockfile-only
pnpm run check
```

`pnpm run check` 会生成 `dist/` 并验证占位符替换、无本地地址残留、注册中心链路代码完整。

## 环境变量

- `TMB_PUBLIC_BASE_URL`：发布根地址，默认 `https://fastly.jsdelivr.net/gh/ultralan/tampermonkey-base@published`
- `TMB_SUPABASE_URL` / `TMB_SUPABASE_ANON_KEY`：注入客户端，用于查询注册中心与写日志
- `TMB_SUPABASE_SERVICE_ROLE_KEY`：Actions 写构建记录用（可选）

## Supabase 初始化

1. 在 SQL Editor 执行 `supabase/migrations/002_federated.sql`；
2. Dashboard → Settings → API → **Exposed schemas** 添加 `tampermonkey_base`（PostgREST 默认只暴露 public，这步必须手动做）；
3. 验证链路：

```bash
TMB_SUPABASE_URL=你的项目URL \
TMB_SUPABASE_ANON_KEY=你的publishable key \
pnpm run probe-supabase
```

## 权限模型

| 表 | anon | authenticated | service role |
|---|---|---|---|
| `plugins` | select（仅 enabled=true） | select | 读写（注册/停用） |
| `client_logs` | insert | select | 读写 |
| `builds` | - | select | 读写 |
| 插件业务表 | 由插件仓 migration 自行定义 | | |

注册表停用插件：在 Supabase 面板把 `plugins.enabled` 翻成 false 即可，客户端不再加载；发布流程不会改动该开关。

## 新增一个插件

1. 新建仓库 `tampermonkey-plugin-<id>`，包含 `plugin.json` + `plugin.user.js`：

```js
(function (TM) {
  TM.log("info", "plugin_boot", {});
})(TM);
```

可用 API（由客户端注入）：

- `TM.log(level, event, data)`：写日志
- `TM.getValue(key, fallback)` / `TM.setValue(key, value)`：插件级持久化
- `TM.rest(path, { method, payload, prefer })`：访问 `tampermonkey_base` schema 的 PostgREST 接口（自动带认证与 `Content-Profile` 头）
- `TM.setClipboard(text)`、`TM.registerMenuCommand(name, handler)`、`TM.page()`

2. 复制本仓或任意插件仓的 `.github/workflows/publish.yml`（发布 + 注册）；
3. 配置 secret `TMB_SUPABASE_SERVICE_ROLE_KEY`；
4. 推送 `main`，注册完成，客户端自动发现。

参考实现：[tampermonkey-plugin-mianshiya](https://github.com/ultralan/tampermonkey-plugin-mianshiya)（面试鸭题库自动采集）。

## 已知限制

- 客户端插件脚本经 jsDelivr 分发，CDN 边缘缓存发布后可能有几分钟延迟；
- 注册中心（Supabase）不可达时客户端使用本地缓存的插件列表降级运行；
- 客户端自身的更新依赖 Tampermonkey 的版本检查（`0.1.<run number>` 单调递增），插件则每次页面加载都拉最新。

## 本地遗留文件

工作目录中的 `mianshiya-*.mjs` 等旧调试脚本与题库数据不进入 Git 仓库，仅供历史对照。
