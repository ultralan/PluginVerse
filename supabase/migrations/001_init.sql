create extension if not exists pgcrypto;

create table if not exists public.plugin_verse_builds (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  commit_sha text,
  manifest_url text not null,
  client_url text,
  public_base_url text not null,
  plugins jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.plugin_verse_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_name text not null default 'PluginVerse',
  client_version text,
  manifest_version text,
  plugin_id text,
  plugin_version text,
  level text not null default 'info',
  event text not null,
  message text,
  data jsonb not null default '{}'::jsonb,
  page jsonb not null default '{}'::jsonb,
  session_id text,
  inserted_at timestamptz not null default now()
);

create index if not exists plugin_verse_logs_created_at_idx
  on public.plugin_verse_logs (created_at desc);

create index if not exists plugin_verse_logs_plugin_created_idx
  on public.plugin_verse_logs (plugin_id, created_at desc);

create index if not exists plugin_verse_logs_session_created_idx
  on public.plugin_verse_logs (session_id, created_at desc);

create index if not exists plugin_verse_logs_event_idx
  on public.plugin_verse_logs (event);

alter table public.plugin_verse_builds enable row level security;
alter table public.plugin_verse_logs enable row level security;

grant insert on public.plugin_verse_logs to anon;
grant select on public.plugin_verse_logs to authenticated;
grant select on public.plugin_verse_builds to authenticated;

drop policy if exists "plugin_verse logs anon insert" on public.plugin_verse_logs;
create policy "plugin_verse logs anon insert"
  on public.plugin_verse_logs
  for insert
  to anon
  with check (true);

drop policy if exists "plugin_verse logs authenticated read" on public.plugin_verse_logs;
create policy "plugin_verse logs authenticated read"
  on public.plugin_verse_logs
  for select
  to authenticated
  using (true);

drop policy if exists "plugin_verse builds authenticated read" on public.plugin_verse_builds;
create policy "plugin_verse builds authenticated read"
  on public.plugin_verse_builds
  for select
  to authenticated
  using (true);

comment on table public.plugin_verse_builds is
  'PluginVerse 构建发布记录。GitHub Actions 或 Agent 使用 service role 写入。';

comment on table public.plugin_verse_logs is
  'PluginVerse 浏览器客户端运行日志。浏览器 anon key 只允许插入，Agent 用受控凭据读取。';
