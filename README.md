# PluginVerse

PluginVerse 是一个单入口油猴脚本系统。用户只安装 `client/pluginverse.user.js`，客户端启动后拉取远端 `manifest.json`，再按当前站点动态加载对应插件。

当前第一个插件是 `mianshiya`，由旧的面试鸭辅助脚本拆出。

## 架构

- `client/`：唯一用户安装入口，负责拉取清单、匹配插件、加载脚本、上报日志。
- `server/plugins/`：插件实现目录，每个站点或能力一个插件。
- `scripts/`：构建和验证脚本。
- `supabase/`：Supabase 表结构和 RLS 策略。
- `.github/workflows/`：GitHub Actions 发布到 Pages。

运行时链路：

```text
浏览器 PluginVerse client
  -> 拉 GitHub Pages manifest
  -> 按站点加载插件
  -> 插件执行页面能力
  -> 日志写入 Supabase pluginverse_logs
  -> Agent 读取日志并改插件代码
  -> push GitHub
  -> Actions 构建发布新 manifest / 插件
```

## 本地构建

```bash
pnpm install --lockfile-only
pnpm run check
```

`pnpm run check` 会生成 `dist/`，并验证：

- `dist/manifest.json` 存在且包含插件；
- 插件脚本 hash 与 manifest 一致；
- 发布客户端没有依赖 `127.0.0.1` 或 `localhost`；
- 构建占位符已经被替换。

## GitHub Pages 配置

在仓库的 `Settings -> Pages` 中选择 GitHub Actions 部署。

需要配置变量和密钥：

- `vars.PLUGINVERSE_PUBLIC_BASE_URL`：Pages 发布根地址，例如 `https://<user>.github.io/<repo>`。
- `vars.PLUGINVERSE_SUPABASE_URL`：Supabase 项目 URL。
- `secrets.PLUGINVERSE_SUPABASE_ANON_KEY`：Supabase anon key。
- `secrets.PLUGINVERSE_SUPABASE_SERVICE_ROLE_KEY`：可选，用于 Actions 写入 `pluginverse_builds`。不配置也能发布。

推送到 `main` 或 `master` 后，Actions 会构建并发布：

- `manifest.json`
- `client/pluginverse.user.js`
- `plugins/<plugin-id>/plugin.user.js`

`PLUGINVERSE_PUBLIC_BASE_URL` 未配置时，Actions 会按仓库自动推导为 `https://<owner>.github.io/<repo>`。客户端版本号使用 `0.1.<GitHub run number>`，确保油猴更新比较是单调递增的。

## Supabase

执行 `supabase/migrations/001_init.sql` 建表。

浏览器端只使用 anon key 写入 `pluginverse_logs`。Agent 或 GitHub Actions 如需读取日志、写构建记录，应使用受控环境里的 service role key，不要把 service role key 写入油猴脚本。

核心表：

- `pluginverse_logs`：客户端和插件运行日志。
- `pluginverse_builds`：发布记录，预留给 Actions 或 Agent 写入。

## 安装客户端

发布完成后，用户只需要安装：

```text
<PLUGINVERSE_PUBLIC_BASE_URL>/client/pluginverse.user.js
```

本地 `dist/` 默认使用 `https://ultralan.github.io/PluginVerse` 作为发布地址；需要验证其他仓库或自定义域名时，设置 `PLUGINVERSE_PUBLIC_BASE_URL` 覆盖即可。

之后新增站点插件时，只改 `server/plugins/` 并推送。用户侧仍然使用同一个客户端入口。

## 新增插件

新增一个目录：

```text
server/plugins/<plugin-id>/
  plugin.json
  plugin.user.js
```

`plugin.json` 必须包含：

- `id`
- `name`
- `version`
- `description`
- `matches`

`plugin.user.js` 通过全局参数接收 `PluginVerse` API：

```js
(function (PluginVerse) {
  PluginVerse.log("info", "plugin_boot", {});
})(PluginVerse);
```

可用 API：

- `PluginVerse.log(level, event, data)`：写日志到本地缓存和 Supabase。
- `PluginVerse.getValue(key, fallback)` / `PluginVerse.setValue(key, value)`：插件级持久化。
- `PluginVerse.setClipboard(text)`：写剪贴板。
- `PluginVerse.postJson(url, payload)`：跨域 POST JSON。
- `PluginVerse.page()`：读取当前页面快照。

## 本地遗留文件

旧的本地调试脚本、题库数据和日志保留在工作目录中用于对照，但不进入 Git 仓库。新的主链路已经不依赖本地 server。
