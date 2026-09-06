const supabaseUrl = process.env.TMB_SUPABASE_URL || "";
const anonKey = process.env.TMB_SUPABASE_ANON_KEY || "";
const SCHEMA = "tampermonkey_base";

function required(value, name) {
  if (!value) {
    throw new Error(`${name} 未配置`);
  }
  return value;
}

async function request(path, options = {}) {
  const baseUrl = required(supabaseUrl, "TMB_SUPABASE_URL").replace(/\/+$/, "");
  const key = required(anonKey, "TMB_SUPABASE_ANON_KEY");
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Accept-Profile": SCHEMA,
      ...options.headers,
    },
  });
  const text = await response.text();
  return { response, text };
}

async function probeRegistry() {
  const { response, text } = await request("/rest/v1/plugins?select=id&enabled=eq.true&limit=1");
  if (!response.ok) {
    throw new Error(`plugins 注册中心查询失败：HTTP ${response.status} ${text}`);
  }
  console.log("tampermonkey_base.plugins 注册中心可查询。");
}

async function probeInsertLog() {
  const payload = {
    client_name: "Tampermonkey Base",
    client_version: "probe",
    level: "info",
    event: "agent_schema_probe",
    message: "Supabase schema probe",
    data: {},
    page: {},
    session_id: "agent-probe",
  };

  const { response, text } = await request("/rest/v1/client_logs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Profile": SCHEMA,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`client_logs 插入失败：HTTP ${response.status} ${text}`);
  }

  console.log("tampermonkey_base.client_logs anon 插入可用。");
}

async function main() {
  await probeRegistry();
  await probeInsertLog();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
