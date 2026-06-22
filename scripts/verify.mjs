import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist");
const manifestPath = resolve(distDir, "manifest.json");
const clientPath = resolve(distDir, "client/pluginverse.user.js");

function fail(message) {
  console.error(`验证失败：${message}`);
  process.exitCode = 1;
}

async function mustRead(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    fail(`无法读取 ${path}: ${error.message}`);
    return "";
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function main() {
  const manifestText = await mustRead(manifestPath);
  const clientText = await mustRead(clientPath);
  if (!manifestText || !clientText) {
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    fail(`manifest 不是合法 JSON: ${error.message}`);
    return;
  }

  if (manifest.name !== "PluginVerse") {
    fail("manifest.name 必须是 PluginVerse");
  }

  if (!Array.isArray(manifest.plugins) || manifest.plugins.length < 1) {
    fail("manifest.plugins 至少要包含一个插件");
  }

  for (const plugin of manifest.plugins || []) {
    if (!plugin.id || !plugin.entry || !plugin.sha256 || !Array.isArray(plugin.matches)) {
      fail(`插件元数据不完整：${JSON.stringify(plugin)}`);
      continue;
    }

    const pluginPath = resolve(distDir, plugin.entry);
    const pluginSource = await mustRead(pluginPath);
    if (!pluginSource) {
      continue;
    }

    const actualHash = sha256(pluginSource);
    if (actualHash !== plugin.sha256) {
      fail(`${plugin.id} 的 sha256 不匹配`);
    }

    if (pluginSource.includes("__PLUGINVERSE_")) {
      fail(`${plugin.id} 仍包含未替换的占位符`);
    }

    const info = await stat(pluginPath);
    if (info.size < 1000) {
      fail(`${plugin.id} 发布脚本体积异常小`);
    }

    if (plugin.id === "mianshiya") {
      const requiredSnippets = [
        "mianshiya-md-download-button",
        "downloadMarkdown",
        "URL.createObjectURL",
        ".md",
      ];
      for (const snippet of requiredSnippets) {
        if (!pluginSource.includes(snippet)) {
          fail(`mianshiya 缺少 Markdown 下载能力标识：${snippet}`);
        }
      }
    }
  }

  if (!clientText.includes("PluginVerse")) {
    fail("客户端脚本缺少 PluginVerse 标识");
  }

  if (clientText.includes("127.0.0.1") || clientText.includes("localhost")) {
    fail("发布客户端不应该依赖本地 server");
  }

  if (clientText.includes("__PLUGINVERSE_")) {
    fail("客户端仍包含未替换的占位符");
  }

  if (clientText.includes("pluginverse_logs") || manifestText.includes("pluginverse_")) {
    fail("发布产物仍包含旧的 Supabase 表名前缀 pluginverse_");
  }

  if (!clientText.includes("/rest/v1/plugin_verse_logs")) {
    fail("客户端日志上报必须写入 plugin_verse_logs");
  }

  if (!process.exitCode) {
    console.log("验证通过：dist 产物结构、manifest、hash 和客户端占位符均正确。");
  }
}

main().catch((error) => {
  fail(error.stack || error.message);
});
