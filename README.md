# Tampermonkey Base

装一次客户端，Supabase 当注册中心，自动发现并加载你所有仓库里的油猴插件——新增插件零改动、零重装。

## 安装

1. 浏览器装好 [Tampermonkey](https://www.tampermonkey.net/)；
2. 点 [一键安装客户端](https://cdn.jsdelivr.net/gh/ultralan/tampermonkey-base@published/client/tampermonkey-base.user.js)，确认安装。

完成。之后插件按你访问的网站自动加载、自动更新。

## Quickstart：接入一个插件

**1. 建仓库 `tampermonkey-plugin-<id>`，放两个文件：**

`plugin.json`：

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "description": "一句话描述",
  "matches": ["*://example.com/*"]
}
```

`plugin.user.js`：

```js
(function (TM) {
  "use strict";
  TM.log("info", "boot", { url: location.href });
})(TM);
```

**2. 复制发布 workflow**（从 [tampermonkey-plugin-mianshiya](https://github.com/ultralan/tampermonkey-plugin-mianshiya) 拿 `.github/workflows/publish.yml`），在仓库 Secrets 里配一个：

```
TMB_SUPABASE_SERVICE_ROLE_KEY = <Supabase Dashboard → Settings → API Keys 里的 service_role key>
```

**3. push 到 main。**

流程结束。CI 会把脚本发到本仓 `published` 分支（jsDelivr 可访问）并自动注册，客户端下次刷新页面就加载你的插件。之后每次 push 都是自动发布 + 自动更新。

## 插件 API

| API | 说明 |
|---|---|
| `TM.log(level, event, data)` | 运行日志 |
| `TM.rest(path, { method, payload, prefer })` | 写 `tampermonkey_base` schema 的 PostgREST 表（自动带认证与 schema 头） |
| `TM.getValue` / `TM.setValue` | 插件级持久化 |
| `TM.setClipboard(text)` | 写剪贴板 |
| `TM.registerMenuCommand(name, handler)` | 油猴菜单项 |
| `TM.postJson(url, payload)` | 跨域 POST |
| `TM.page()` | 页面快照 |

要存业务数据：在插件仓加 `supabase/migrations/` 建表（同样放 `tampermonkey_base` schema），anon 需要 `select + insert + update` 三权限才能 upsert；超过 15 位的站点 ID 用 `text` 列（JS Number 精度只有 2^53）。

## 更多

- 完整参考实现：[tampermonkey-plugin-mianshiya](https://github.com/ultralan/tampermonkey-plugin-mianshiya)（面试鸭题库自动采集）
- 自建一套基座：执行 `supabase/migrations/002_federated.sql`，Dashboard → Settings → API → Exposed schemas 添加 `tampermonkey_base`，再改 workflow 里的仓库指向
- 插件脚本受三重保护：jsDelivr 域白名单 + sha256 校验 + 注册表 RLS（anon 只读）
