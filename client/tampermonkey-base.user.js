// ==UserScript==
// @name         Tampermonkey Base Client
// @namespace    tampermonkey-base.client
// @version      __TMB_BUILD_VERSION__
// @description  油猴插件基座客户端：从 Supabase 注册中心发现插件，按站点动态加载。
// @match        *://*/*
// @updateURL    __TMB_CLIENT_URL__
// @downloadURL  __TMB_CLIENT_URL__
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setClipboard
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  const CLIENT_NAME = "Tampermonkey Base";
  const CLIENT_VERSION = "__TMB_BUILD_VERSION__";
  const SUPABASE_URL = "__TMB_SUPABASE_URL__";
  const SUPABASE_ANON_KEY = "__TMB_SUPABASE_ANON_KEY__";
  const SCHEMA = "tampermonkey_base";
  const PLUGINS_CACHE_KEY = "tmb_plugins_cache";
  const LOG_CACHE_KEY = "tmb_recent_logs";
  const MAX_LOGS = 200;
  // 供应链防护：只执行可信 CDN 上本 owner 名下的插件脚本。
  const SCRIPT_URL_ALLOWLIST = /^https:\/\/(?:fastly\.jsdelivr\.net|cdn\.jsdelivr\.net|gcore\.jsdelivr\.net)\/gh\/ultralan\/[^/]+\/.+$/;

  const state = {
    plugins: [],
    activePlugins: [],
    sessionId: getOrCreateSessionId(),
    pageStartedAt: new Date().toISOString(),
  };

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function safeString(value) {
    if (value instanceof Error) {
      return `${value.name}: ${value.message}\n${value.stack || ""}`.trim();
    }
    if (typeof value === "string") {
      return value;
    }
    return safeJson(value);
  }

  function messageFromData(event, data) {
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof Error) {
      return safeString(data);
    }
    if (data && typeof data.message === "string") {
      return data.message;
    }
    return event;
  }

  function gmGet(key, fallback) {
    try {
      return GM_getValue(key, fallback);
    } catch {
      return fallback;
    }
  }

  function gmSet(key, value) {
    try {
      GM_setValue(key, value);
    } catch {
      // Tampermonkey 存储失败不能影响页面脚本。
    }
  }

  function getOrCreateSessionId() {
    const key = "tmb_session_id";
    const existing = gmGet(key, "");
    if (existing) {
      return existing;
    }
    const created = `tmb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    gmSet(key, created);
    return created;
  }

  function readRecentLogs() {
    const logs = gmGet(LOG_CACHE_KEY, []);
    return Array.isArray(logs) ? logs : [];
  }

  function writeRecentLog(row) {
    const logs = readRecentLogs();
    logs.push(row);
    gmSet(LOG_CACHE_KEY, logs.slice(-MAX_LOGS));
  }

  function currentPage() {
    return {
      href: location.href,
      origin: location.origin,
      host: location.host,
      pathname: location.pathname,
      title: document.title,
      readyState: document.readyState,
      userAgent: navigator.userAgent,
    };
  }

  function requestText(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url: options.url,
        headers: options.headers || {},
        data: options.data,
        timeout: options.timeout || 8000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}: ${response.responseText || ""}`.trim()));
            return;
          }
          resolve(response.responseText || "");
        },
        onerror(error) {
          reject(new Error(error?.error || "network error"));
        },
        ontimeout() {
          reject(new Error("timeout"));
        },
      });
    });
  }

  async function requestJson(options) {
    const text = await requestText(options);
    return JSON.parse(text || "{}");
  }

  function emit(level, event, data, pluginMeta) {
    const row = {
      created_at: new Date().toISOString(),
      client_name: CLIENT_NAME,
      client_version: CLIENT_VERSION,
      plugin_id: pluginMeta?.id || "",
      plugin_version: pluginMeta?.version || "",
      level,
      event,
      message: messageFromData(event, data),
      data: data && typeof data === "object" && !(data instanceof Error) ? data : {},
      session_id: state.sessionId,
      page: currentPage(),
    };

    writeRecentLog(row);
    sendSupabaseLog(row);

    try {
      console[level === "error" ? "error" : "log"]("[Tampermonkey Base]", event, row.message);
    } catch {
      // 页面可能改写 console。
    }
  }

  function sendSupabaseLog(row) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return;
    }

    try {
      GM_xmlhttpRequest({
        method: "POST",
        url: `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/client_logs`,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          "Content-Profile": SCHEMA,
          Prefer: "return=minimal",
        },
        data: JSON.stringify(row),
        timeout: 5000,
      });
    } catch {
      // 日志上报失败时保留本地最近日志即可。
    }
  }

  // 注册中心访问：读插件表、写业务表都走这里，统一带 schema 头。
  async function supabaseRest(path, { method = "GET", payload, prefer, timeout } = {}) {
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Accept-Profile": SCHEMA,
    };
    if (method !== "GET") {
      headers["Content-Profile"] = SCHEMA;
    }
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (prefer) {
      headers.Prefer = prefer;
    }

    const text = await requestText({
      method,
      url: `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${String(path).replace(/^\/+/, "")}`,
      headers,
      data: payload === undefined ? undefined : JSON.stringify(payload),
      timeout: timeout || 8000,
    });
    return text ? JSON.parse(text) : {};
  }

  function patternToRegExp(pattern) {
    const escaped = String(pattern)
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
  }

  function matchPlugins(plugins) {
    return plugins.filter((plugin) => {
      const matches = Array.isArray(plugin.matches) ? plugin.matches : [];
      return matches.some((pattern) => patternToRegExp(pattern).test(location.href));
    });
  }

  function isValidRegistryEntry(plugin) {
    return Boolean(
      plugin &&
      plugin.id &&
      typeof plugin.script_url === "string" &&
      SCRIPT_URL_ALLOWLIST.test(plugin.script_url) &&
      plugin.sha256,
    );
  }

  async function loadRegistry() {
    try {
      const plugins = await supabaseRest(
        "plugins?select=id,name,version,description,matches,script_url,sha256&enabled=eq.true&order=id",
        { timeout: 8000 },
      );
      const list = Array.isArray(plugins) ? plugins : [];
      const valid = list.filter(isValidRegistryEntry);
      for (const invalid of list.filter((plugin) => !isValidRegistryEntry(plugin))) {
        emit("warn", "registry_entry_rejected", { pluginId: invalid?.id || "", scriptUrl: invalid?.script_url || "" });
      }
      if (valid.length > 0) {
        gmSet(PLUGINS_CACHE_KEY, valid);
      }
      return valid;
    } catch (error) {
      const cached = gmGet(PLUGINS_CACHE_KEY, []);
      if (Array.isArray(cached) && cached.length > 0) {
        emit("warn", "registry_cache_fallback", error);
        return cached;
      }
      throw error;
    }
  }

  async function loadPlugin(plugin) {
    const url = `${plugin.script_url}${plugin.script_url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const source = await requestText({ url, timeout: 10000 });
    await verifyPluginSource(plugin, source);

    const api = {
      client: {
        name: CLIENT_NAME,
        version: CLIENT_VERSION,
        sessionId: state.sessionId,
        pageStartedAt: state.pageStartedAt,
      },
      plugin,
      log(level, event, data) {
        emit(level || "info", event || "plugin_log", data, plugin);
      },
      getValue(key, fallback) {
        return gmGet(`plugin:${plugin.id}:${key}`, fallback);
      },
      setValue(key, value) {
        gmSet(`plugin:${plugin.id}:${key}`, value);
      },
      setClipboard(text) {
        GM_setClipboard(String(text || ""), "text");
      },
      // 写入注册中心所在 schema 的业务表（如 questions），自动带认证与 Content-Profile 头。
      // options: { method, payload, prefer, select }
      rest(path, options = {}) {
        return supabaseRest(options.select ? `${path}?select=${options.select}` : path, {
          method: options.method || "POST",
          payload: options.payload,
          prefer: options.prefer,
          timeout: options.timeout,
        });
      },
      registerMenuCommand(name, handler) {
        if (typeof GM_registerMenuCommand !== "function") {
          emit("warn", "plugin_menu_unavailable", { pluginId: plugin.id, name }, plugin);
          return;
        }

        return GM_registerMenuCommand(`${plugin.name || plugin.id}：${name}`, () => {
          try {
            const result = handler?.();
            if (result && typeof result.catch === "function") {
              result.catch((error) => emit("error", "plugin_menu_action_failed", {
                pluginId: plugin.id,
                name,
                error: safeString(error),
              }, plugin));
            }
          } catch (error) {
            emit("error", "plugin_menu_action_failed", {
              pluginId: plugin.id,
              name,
              error: safeString(error),
            }, plugin);
          }
        });
      },
      unregisterMenuCommand(commandId) {
        if (commandId && typeof GM_unregisterMenuCommand === "function") {
          GM_unregisterMenuCommand(commandId);
        }
      },
      postJson: async (url, payload, timeout) => {
        const text = await requestText({
          method: "POST",
          url,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify(payload || {}),
          timeout: timeout || 8000,
        });
        return text ? JSON.parse(text) : {};
      },
      page: currentPage,
    };

    runPlugin(source, api);
    emit("info", "plugin_loaded", { pluginId: plugin.id, version: plugin.version }, plugin);
  }

  async function verifyPluginSource(plugin, source) {
    if (!crypto?.subtle || typeof TextEncoder !== "function") {
      emit("warn", "plugin_hash_verify_unavailable", { pluginId: plugin.id }, plugin);
      return;
    }

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    const actual = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    if (actual !== plugin.sha256) {
      throw new Error(`插件 ${plugin.id} hash 校验失败`);
    }
  }

  function runPlugin(source, api) {
    const runner = new Function("TM", source);
    runner(api);
  }

  function copyDebugLogs() {
    const payload = {
      copiedAt: new Date().toISOString(),
      client: CLIENT_NAME,
      clientVersion: CLIENT_VERSION,
      registry: state.plugins,
      activePlugins: state.activePlugins,
      page: currentPage(),
      logs: readRecentLogs(),
    };
    GM_setClipboard(JSON.stringify(payload, null, 2), "text");
    emit("info", "debug_logs_copied", { count: payload.logs.length });
  }

  function registerMenu() {
    try {
      GM_registerMenuCommand("Tampermonkey Base：复制调试日志", copyDebugLogs);
      GM_registerMenuCommand("Tampermonkey Base：重新加载插件", () => {
        boot().catch((error) => emit("error", "manual_reload_failed", error));
      });
      GM_registerMenuCommand("Tampermonkey Base：清缓存并重新加载插件", () => {
        gmSet(PLUGINS_CACHE_KEY, []);
        boot().catch((error) => emit("error", "manual_reload_after_cache_clear_failed", error));
      });
    } catch (error) {
      emit("warn", "register_menu_failed", error);
    }
  }

  async function boot() {
    emit("info", "client_boot", { url: location.href });
    state.plugins = await loadRegistry();
    state.activePlugins = matchPlugins(state.plugins);
    if (state.activePlugins.length === 0) {
      emit("info", "no_plugin_matched", { url: location.href, registrySize: state.plugins.length });
      return;
    }

    // 单个插件失败跳过，不影响其他插件。
    await Promise.all(
      state.activePlugins.map((plugin) =>
        loadPlugin(plugin).catch((error) =>
          emit("error", "plugin_load_failed", { pluginId: plugin.id, error: safeString(error) }, plugin),
        ),
      ),
    );
  }

  registerMenu();
  boot().catch((error) => emit("error", "client_boot_failed", error));
})();
