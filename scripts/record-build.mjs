const supabaseUrl = process.env.TMB_SUPABASE_URL || "";
const serviceRoleKey = process.env.TMB_SUPABASE_SERVICE_ROLE_KEY || "";
const schema = "tampermonkey_base";

function required(value, name) {
  if (!value) {
    throw new Error(`${name} 未配置`);
  }
  return value;
}

async function main() {
  const version = process.env.TMB_BUILD_VERSION || `local-${new Date().toISOString()}`;

  if (!supabaseUrl || !serviceRoleKey) {
    console.log("未配置 Supabase service role，跳过构建记录写入。");
    return;
  }

  const payload = {
    repo: process.env.GITHUB_REPOSITORY || "ultralan/tampermonkey-base",
    version,
    commit_sha: process.env.GITHUB_SHA || "",
    public_base_url: process.env.TMB_PUBLIC_BASE_URL || "",
    artifact_url: `${(process.env.TMB_PUBLIC_BASE_URL || "").replace(/\/+$/, "")}/client/tampermonkey-base.user.js`,
    sha256: "",
  };

  const response = await fetch(`${required(supabaseUrl, "TMB_SUPABASE_URL").replace(/\/+$/, "")}/rest/v1/builds`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "Content-Profile": schema,
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
