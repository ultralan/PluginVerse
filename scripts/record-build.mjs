import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const supabaseUrl = process.env.PLUGINVERSE_SUPABASE_URL || "";
const serviceRoleKey = process.env.PLUGINVERSE_SUPABASE_SERVICE_ROLE_KEY || "";

function required(value, name) {
  if (!value) {
    throw new Error(`${name} 未配置`);
  }
  return value;
}

async function main() {
  if (!supabaseUrl || !serviceRoleKey) {
    console.log("未配置 Supabase service role，跳过构建记录写入。");
    return;
  }

  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "dist/manifest.json"), "utf8"));
  const payload = {
    version: manifest.version,
    commit_sha: process.env.GITHUB_SHA || "",
    manifest_url: `${manifest.publicBaseUrl}/manifest.json`,
    client_url: manifest.client?.url || "",
    public_base_url: required(manifest.publicBaseUrl, "manifest.publicBaseUrl"),
    plugins: manifest.plugins || [],
  };

  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/plugin_verse_builds`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`写入构建记录失败：HTTP ${response.status} ${await response.text()}`);
  }

  console.log(`构建记录已写入 Supabase：${payload.version}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
