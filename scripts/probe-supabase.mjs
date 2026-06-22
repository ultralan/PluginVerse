const supabaseUrl = process.env.PLUGINVERSE_SUPABASE_URL || "";
const anonKey = process.env.PLUGINVERSE_SUPABASE_ANON_KEY || "";

function required(value, name) {
  if (!value) {
    throw new Error(`${name} 未配置`);
  }
  return value;
}

async function request(path, options = {}) {
  const baseUrl = required(supabaseUrl, "PLUGINVERSE_SUPABASE_URL").replace(/\/+$/, "");
  const key = required(anonKey, "PLUGINVERSE_SUPABASE_ANON_KEY");
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...options.headers,
    },
  });
  const text = await response.text();
  return { response, text };
}

function isMissingTable(response, text) {
  if (response.status !== 404) {
    return false;
  }

  try {
    const error = JSON.parse(text);
    return error.code === "PGRST205";
  } catch {
    return false;
  }
}

async function probeTableRoute(table, expectedAnonAccess) {
  const { response, text } = await request(`/rest/v1/${table}?select=id&limit=1`);

  if (isMissingTable(response, text)) {
    throw new Error(`${table} 查询失败：HTTP ${response.status} ${text}`);
  }

  if (response.ok) {
    console.log(`${table} 可查询。`);
    return;
  }

  if (!expectedAnonAccess && (response.status === 401 || response.status === 403)) {
    console.log(`${table} 已存在，且 anon 无读取权限，符合预期。`);
    return;
  }

  throw new Error(`${table} 查询失败：HTTP ${response.status} ${text}`);
}

async function probeInsertLog() {
  const payload = {
    client_name: "PluginVerse",
    client_version: "probe",
    level: "info",
    event: "agent_schema_probe",
    message: "Supabase schema probe",
    data: {},
    page: {},
    session_id: "agent-probe",
  };

  const { response, text } = await request("/rest/v1/plugin_verse_logs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`plugin_verse_logs 插入失败：HTTP ${response.status} ${text}`);
  }

  console.log("plugin_verse_logs anon 插入可用。");
}

async function main() {
  await probeTableRoute("plugin_verse_logs", false);
  await probeTableRoute("plugin_verse_builds", false);
  await probeInsertLog();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
