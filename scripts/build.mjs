import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist");
const clientSourcePath = resolve(root, "client/tampermonkey-base.user.js");
const clientEntry = "client/tampermonkey-base.user.js";

const publicBaseUrl = stripTrailingSlash(
  normalizePublicBaseUrl(
    process.env.TMB_PUBLIC_BASE_URL ||
      "https://fastly.jsdelivr.net/gh/ultralan/tampermonkey-base@published",
  ),
);
const supabaseUrl = process.env.TMB_SUPABASE_URL || "";
const supabaseAnonKey = process.env.TMB_SUPABASE_ANON_KEY || "";
const buildVersion =
  process.env.TMB_BUILD_VERSION ||
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

function replacePlaceholders(source) {
  return source
    .replaceAll("__TMB_CLIENT_URL__", `${publicBaseUrl}/${clientEntry}`)
    .replaceAll("__TMB_SUPABASE_URL__", supabaseUrl)
    .replaceAll("__TMB_SUPABASE_ANON_KEY__", supabaseAnonKey)
    .replaceAll("__TMB_BUILD_VERSION__", buildVersion);
}

async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const clientSource = await readFile(clientSourcePath, "utf8");
  const clientOutput = replacePlaceholders(clientSource);
  await writeText(resolve(distDir, clientEntry), clientOutput);

  await cp(resolve(root, "supabase"), resolve(distDir, "supabase"), {
    recursive: true,
    force: true,
  }).catch(() => {});

  console.log(`Tampermonkey Base 构建完成：${distDir}`);
  console.log(`client: ${publicBaseUrl}/${clientEntry}`);
  console.log(`version: ${buildVersion}`);
  console.log(`supabase: ${supabaseUrl ? supabaseUrl : "(未配置)"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
