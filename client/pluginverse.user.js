// ==UserScript==
// @name         PluginVerse Client
// @namespace    pluginverse.client
// @version      __PLUGINVERSE_BUILD_VERSION__
// @description  单入口油猴客户端：按站点动态加载插件，并把运行日志写入 Supabase。
// @match        *://*/*
// @updateURL    __PLUGINVERSE_CLIENT_URL__
// @downloadURL  __PLUGINVERSE_CLIENT_URL__
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

  const CLIENT_NAME = "PluginVerse";
  const CLIENT_VERSION = "__PLUGINVERSE_BUILD_VERSION__";
  const MANIFEST_URL = "__PLUGINVERSE_MANIFEST_URL__";
  const SUPABASE_URL = "__PLUGINVERSE_SUPABASE_URL__";
  const SUPABASE_ANON_KEY = "__PLUGINVERSE_SUPABASE_ANON_KEY__";
  const MANIFEST_CACHE_KEY = "pluginverse_manifest_cache";
  const LOG_CACHE_KEY = "pluginverse_recent_logs";
  const MAX_LOGS = 200;

  const state = {
    manifest: null,
    plugin: null,
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
    const key = "pluginverse_session_id";
    const existing = gmGet(key, "");
    if (existing) {
      return existing;
    }
    const created = `pv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

  function emit(level, event, data) {
    const row = {
      created_at: new Date().toISOString(),
      client_name: CLIENT_NAME,
      client_version: CLIENT_VERSION,
      manifest_version: state.manifest?.version || "",
      plugin_id: state.plugin?.id || "",
      plugin_version: state.plugin?.version || "",
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
      console[level === "error" ? "error" : "log"]("[PluginVerse]", event, row.message);
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
        url: `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/plugin_verse_logs`,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        data: JSON.stringify(row),
        timeout: 5000,
      });
    } catch {
      // 日志上报失败时保留本地最近日志即可。
    }
  }

  function patternToRegExp(pattern) {
    const escaped = String(pattern)
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
  }

  function matchPlugin(manifest) {
    const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
    return plugins.find((plugin) => {
      const matches = Array.isArray(plugin.matches) ? plugin.matches : [];
      return matches.some((pattern) => patternToRegExp(pattern).test(location.href));
    });
  }

  async function loadManifest() {
    try {
      const manifest = await requestJson({
        url: `${MANIFEST_URL}${MANIFEST_URL.includes("?") ? "&" : "?"}t=${Date.now()}`,
        timeout: 8000,
      });
      gmSet(MANIFEST_CACHE_KEY, manifest);
      return manifest;
    } catch (error) {
      const cached = gmGet(MANIFEST_CACHE_KEY, null);
      if (cached) {
        emit("warn", "manifest_cache_fallback", error);
        return cached;
      }
      throw error;
    }
  }

  async function loadPlugin(plugin) {
    const url = `${plugin.url || plugin.entry}${String(plugin.url || plugin.entry).includes("?") ? "&" : "?"}t=${Date.now()}`;
    const source = await requestText({ url, timeout: 10000 });
    await verifyPluginSource(plugin, source);
    state.plugin = plugin;

    const api = {
      client: {
        name: CLIENT_NAME,
        version: CLIENT_VERSION,
        sessionId: state.sessionId,
        pageStartedAt: state.pageStartedAt,
      },
      plugin,
      log(level, event, data) {
        emit(level || "info", event || "plugin_log", data);
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
      registerMenuCommand(name, handler) {
        if (typeof GM_registerMenuCommand !== "function") {
          emit("warn", "plugin_menu_unavailable", { pluginId: plugin.id, name });
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
              }));
            }
          } catch (error) {
            emit("error", "plugin_menu_action_failed", {
              pluginId: plugin.id,
              name,
              error: safeString(error),
            });
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

    unsafeRunPlugin(source, api);
    emit("info", "plugin_loaded", { pluginId: plugin.id, version: plugin.version });
  }

  async function verifyPluginSource(plugin, source) {
    if (!plugin.sha256) {
      emit("warn", "plugin_hash_missing", { pluginId: plugin.id });
      return;
    }
    if (!crypto?.subtle || typeof TextEncoder !== "function") {
      emit("warn", "plugin_hash_verify_unavailable", { pluginId: plugin.id });
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

  function unsafeRunPlugin(source, api) {
    const runner = new Function("PluginVerse", source);
    runner(api);
  }

  function copyDebugLogs() {
    const payload = {
      copiedAt: new Date().toISOString(),
      client: CLIENT_NAME,
      clientVersion: CLIENT_VERSION,
      manifest: state.manifest,
      activePlugin: state.plugin,
      page: currentPage(),
      logs: readRecentLogs(),
    };
    GM_setClipboard(JSON.stringify(payload, null, 2), "text");
    emit("info", "debug_logs_copied", { count: payload.logs.length });
  }

  function registerMenu() {
    try {
      GM_registerMenuCommand("PluginVerse：复制调试日志", copyDebugLogs);
      GM_registerMenuCommand("PluginVerse：重新加载插件", () => {
        boot().catch((error) => emit("error", "manual_reload_failed", error));
      });
      GM_registerMenuCommand("PluginVerse：清缓存并重新加载插件", () => {
        gmSet(MANIFEST_CACHE_KEY, null);
        boot().catch((error) => emit("error", "manual_reload_after_cache_clear_failed", error));
      });
    } catch (error) {
      emit("warn", "register_menu_failed", error);
    }
  }

  async function boot() {
    emit("info", "client_boot", { url: location.href });
    state.manifest = await loadManifest();
    const plugin = matchPlugin(state.manifest);
    if (!plugin) {
      emit("info", "no_plugin_matched", { url: location.href });
      return;
    }
    await loadPlugin(plugin);
  }

  registerMenu();
  boot().catch((error) => emit("error", "client_boot_failed", error));
})();
