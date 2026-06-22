import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist");
const clientSourcePath = resolve(root, "client/pluginverse.user.js");
const pluginsDir = resolve(root, "server/plugins");

const publicBaseUrl = stripTrailingSlash(
  normalizePublicBaseUrl(
    process.env.PLUGINVERSE_PUBLIC_BASE_URL ||
      "https://fastly.jsdelivr.net/gh/ultralan/PluginVerse@published",
  ),
);
const manifestUrl = `${publicBaseUrl}/manifest.json`;
const supabaseUrl = process.env.PLUGINVERSE_SUPABASE_URL || "";
const supabaseAnonKey = process.env.PLUGINVERSE_SUPABASE_ANON_KEY || "";
const buildVersion =
  process.env.PLUGINVERSE_BUILD_VERSION ||
  (process.env.GITHUB_RUN_NUMBER ? `0.1.${process.env.GITHUB_RUN_NUMBER}` : "") ||
  new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function normalizePublicBaseUrl(value) {
  const rawMatch = String(value).match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/published\/?$/);
  if (!rawMatch) {
    return value;
  }

  return `https://fastly.jsdelivr.net/gh/${rawMatch[1]}/${rawMatch[2]}@published`;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function replacePlaceholders(source) {
  return source
    .replaceAll("__PLUGINVERSE_MANIFEST_URL__", manifestUrl)
    .replaceAll("__PLUGINVERSE_CLIENT_URL__", `${publicBaseUrl}/client/pluginverse.user.js`)
    .replaceAll("__PLUGINVERSE_SUPABASE_URL__", supabaseUrl)
    .replaceAll("__PLUGINVERSE_SUPABASE_ANON_KEY__", supabaseAnonKey)
    .replaceAll("__PLUGINVERSE_BUILD_VERSION__", buildVersion);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

async function buildPlugin(pluginId) {
  const pluginRoot = resolve(pluginsDir, pluginId);
  const metaPath = resolve(pluginRoot, "plugin.json");
  const sourcePath = resolve(pluginRoot, "plugin.user.js");
  const meta = await readJson(metaPath);
  const source = await readFile(sourcePath, "utf8");
  const entry = `plugins/${pluginId}/plugin.user.js`;
  const targetPath = resolve(distDir, entry);

  await writeText(targetPath, source);

  return {
    id: meta.id,
    name: meta.name,
    version: meta.version,
    description: meta.description,
    matches: meta.matches,
    entry,
    url: `${publicBaseUrl}/${entry}`,
    sha256: sha256(source),
    runAt: meta.runAt || "document-start",
  };
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const clientSource = await readFile(clientSourcePath, "utf8");
  const clientOutput = replacePlaceholders(clientSource);
  await writeText(resolve(distDir, "client/pluginverse.user.js"), clientOutput);

  const pluginIds = (await readdir(pluginsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const plugins = [];
  for (const pluginId of pluginIds) {
    plugins.push(await buildPlugin(pluginId));
  }

  const manifest = {
    schemaVersion: 1,
    name: "PluginVerse",
    version: buildVersion,
    generatedAt: new Date().toISOString(),
    publicBaseUrl,
    client: {
      entry: "client/pluginverse.user.js",
      url: `${publicBaseUrl}/client/pluginverse.user.js`,
      sha256: sha256(clientOutput),
    },
    supabase: {
      enabled: Boolean(supabaseUrl && supabaseAnonKey),
      url: supabaseUrl,
    },
    plugins,
  };

  await writeText(resolve(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(resolve(root, "supabase"), resolve(distDir, "supabase"), {
    recursive: true,
    force: true,
  }).catch(() => {});

  console.log(`PluginVerse 构建完成：${distDir}`);
  console.log(`manifest: ${manifestUrl}`);
  console.log(`plugins: ${plugins.map((plugin) => plugin.id).join(", ")}`);
  console.log(`supabase logs: ${manifest.supabase.enabled ? "enabled" : "disabled"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
