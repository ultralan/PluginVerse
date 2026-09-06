import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist");
const clientPath = resolve(distDir, "client/tampermonkey-base.user.js");
const readmePath = resolve(root, "README.md");

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

async function main() {
  const clientText = await mustRead(clientPath);
  const readmeText = await mustRead(readmePath);
  if (!clientText || !readmeText) {
    return;
  }

  if (clientText.includes("127.0.0.1") || clientText.includes("localhost")) {
    fail("发布客户端不应该依赖本地 server");
  }

  if (clientText.includes("raw.githubusercontent.com")) {
    fail("发布客户端不应该依赖 raw.githubusercontent.com 安装链路");
  }

  if (clientText.includes("__TMB_")) {
    fail("客户端仍包含未替换的占位符");
  }

  if (/pluginverse|plugin_verse|PluginVerse/i.test(clientText)) {
    fail("客户端仍包含旧的 PluginVerse 标识");
  }

  const requiredClientSnippets = [
    "Tampermonkey Base",
    "SCRIPT_URL_ALLOWLIST",
    "/rest/v1/client_logs",
    "Content-Profile",
    "registry_cache_fallback",
    "plugin_load_failed",
    "Tampermonkey Base：清缓存并重新加载插件",
    "rest(path, options",
  ];
  for (const snippet of requiredClientSnippets) {
    if (!clientText.includes(snippet)) {
      fail(`客户端缺少注册中心模式必备代码：${snippet}`);
    }
  }

  if (clientText.includes("__TMB_SUPABASE_ANON_KEY__") === false && !clientText.includes("apikey")) {
    fail("客户端缺少 Supabase 认证头");
  }

  if (readmeText.includes("pluginverse") || readmeText.includes("PluginVerse")) {
    fail("README 仍包含旧项目名 PluginVerse");
  }

  if (!process.exitCode) {
    console.log("验证通过：客户端产物、占位符替换、注册中心链路标识均正确。");
  }
}

main().catch((error) => {
  fail(error.stack || error.message);
});
