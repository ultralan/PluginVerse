-- Tampermonkey Base 联邦架构初始化。
-- 包含：schema、插件注册中心、客户端日志、构建记录，并清理旧的 public 表。
-- 面试鸭 questions 表的 DDL 在插件仓 tampermonkey-plugin-mianshiya 的 migration 中维护。
-- 本脚本可重复执行（幂等）。

create extension if not exists pgcrypto;

create schema if not exists tampermonkey_base;

-- ============================================================
-- 插件注册中心：插件仓发布时由 Actions 用 service role upsert。
-- 客户端用 anon 只读 enabled=true 的记录，按 matches 匹配站点后拉取 script_url。
-- ============================================================
create table if not exists tampermonkey_base.plugins (
  id text primary key,
  name text not null,
  version text not null,
  description text not null default '',
  matches text[] not null default '{}',
  script_url text not null,
  sha256 text not null,
  enabled boolean not null default true,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 客户端运行日志（原 public.plugin_verse_logs 搬家，去掉 manifest_version 列）。
-- ============================================================
create table if not exists tampermonkey_base.client_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_name text not null default 'Tampermonkey Base',
  client_version text,
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

-- ============================================================
-- 构建发布记录：基座仓与插件仓的 Actions 均可写入。
-- ============================================================
create table if not exists tampermonkey_base.builds (
  id uuid primary key default gen_random_uuid(),
  repo text not null default '',
  version text not null,
  commit_sha text,
  public_base_url text not null default '',
  artifact_url text,
  sha256 text,
  created_at timestamptz not null default now()
);

alter table tampermonkey_base.plugins enable row level security;
alter table tampermonkey_base.client_logs enable row level security;
alter table tampermonkey_base.builds enable row level security;

-- schema 访问授权
grant usage on schema tampermonkey_base to anon, authenticated;
-- service_role 绕过 RLS，但新建 schema 不会自动获得 USAGE，必须显式授予，
-- 否则 Actions 写注册表/构建记录会报 permission denied for schema。
grant usage on schema tampermonkey_base to service_role;
grant all on all tables in schema tampermonkey_base to service_role;
grant all on all sequences in schema tampermonkey_base to service_role;
alter default privileges in schema tampermonkey_base grant all on tables to service_role;

-- 注册中心：anon/authenticated 只读；写入仅 service role（无写 policy，绕过 RLS）。
grant select on tampermonkey_base.plugins to anon, authenticated;

-- 客户端日志：anon 只能插入，authenticated 可读。
grant insert on tampermonkey_base.client_logs to anon;
grant select on tampermonkey_base.client_logs to authenticated;

-- 构建记录：authenticated 可读。
grant select on tampermonkey_base.builds to authenticated;

drop policy if exists "plugins anon read enabled" on tampermonkey_base.plugins;
create policy "plugins anon read enabled"
  on tampermonkey_base.plugins
  for select
  to anon
  using (enabled = true);

drop policy if exists "plugins owner read all" on tampermonkey_base.plugins;
create policy "plugins owner read all"
  on tampermonkey_base.plugins
  for select
  to authenticated
  using (true);

drop policy if exists "client_logs anon insert" on tampermonkey_base.client_logs;
create policy "client_logs anon insert"
  on tampermonkey_base.client_logs
  for insert
  to anon
  with check (true);

drop policy if exists "client_logs authenticated read" on tampermonkey_base.client_logs;
create policy "client_logs authenticated read"
  on tampermonkey_base.client_logs
  for select
  to authenticated
  using (true);

drop policy if exists "builds authenticated read" on tampermonkey_base.builds;
create policy "builds authenticated read"
  on tampermonkey_base.builds
  for select
  to authenticated
  using (true);

create index if not exists client_logs_created_idx
  on tampermonkey_base.client_logs (created_at desc);

create index if not exists client_logs_event_idx
  on tampermonkey_base.client_logs (event);

create index if not exists client_logs_session_idx
  on tampermonkey_base.client_logs (session_id, created_at desc);

-- 清理旧的 public 表（数据不迁移）。
drop table if exists public.plugin_verse_logs;
drop table if exists public.plugin_verse_builds;

comment on schema tampermonkey_base is 'Tampermonkey Base：插件注册中心与运行数据';

comment on table tampermonkey_base.plugins is
  '插件注册中心。插件仓 Actions 发布成功后用 service role upsert，客户端 anon 只读 enabled=true。';

comment on table tampermonkey_base.client_logs is
  '客户端与插件运行日志。浏览器 anon key 只允许插入。';

comment on table tampermonkey_base.builds is
  '基座仓与插件仓的构建发布记录，Actions 使用 service role 写入。';

-- 注意：还需要在 Supabase Dashboard → Settings → API → Exposed schemas
-- 中添加 tampermonkey_base，PostgREST 才会暴露该 schema。
