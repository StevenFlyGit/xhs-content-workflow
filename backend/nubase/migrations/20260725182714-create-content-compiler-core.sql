create extension if not exists pgcrypto;

create table if not exists public.content_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  event_name text not null default '',
  event_type text not null default 'roundtable',
  original_text text not null default '',
  target_audience text[] not null default '{}',
  tone text not null default '专业复盘',
  output_mode text not null default 'card' check (output_mode in ('summary','card')),
  must_keep_points text[] not null default '{}',
  private_points text[] not null default '{}',
  protected_terms text[] not null default '{}',
  analysis jsonb not null default '{}'::jsonb,
  summary_variant jsonb not null default '{}'::jsonb,
  card_deck jsonb not null default '{}'::jsonb,
  theme_id text not null default 'research-light',
  density text not null default 'standard' check (density in ('relaxed','standard','compact')),
  status text not null default 'draft' check (status in ('draft','analyzing','ready','exported')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.content_projects(id) on delete cascade,
  entity_type text not null check (entity_type in ('analysis','summary','deck')),
  label text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.export_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.content_projects(id) on delete cascade,
  file_name text not null,
  storage_path text,
  theme_id text not null,
  character_count integer not null default 0,
  card_count integer not null default 0,
  status text not null default 'succeeded' check (status in ('pending','running','succeeded','failed')),
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_projects_user_updated_idx on public.content_projects(user_id, updated_at desc);
create index if not exists content_versions_project_created_idx on public.content_versions(project_id, created_at desc);
create index if not exists export_packages_project_created_idx on public.export_packages(project_id, created_at desc);

alter table public.content_projects enable row level security;
alter table public.content_versions enable row level security;
alter table public.export_packages enable row level security;

create policy "content_projects_owner_all" on public.content_projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "content_versions_owner_all" on public.content_versions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "export_packages_owner_all" on public.export_packages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('content-compiler-exports', 'content-compiler-exports', false)
on conflict (id) do update set public = false;

create policy "export_files_owner_read" on storage.objects for select using (bucket_id = 'content-compiler-exports' and split_part(name, '/', 1) = auth.uid()::text);
create policy "export_files_owner_insert" on storage.objects for insert with check (bucket_id = 'content-compiler-exports' and split_part(name, '/', 1) = auth.uid()::text);
create policy "export_files_owner_update" on storage.objects for update using (bucket_id = 'content-compiler-exports' and split_part(name, '/', 1) = auth.uid()::text) with check (bucket_id = 'content-compiler-exports' and split_part(name, '/', 1) = auth.uid()::text);
create policy "export_files_owner_delete" on storage.objects for delete using (bucket_id = 'content-compiler-exports' and split_part(name, '/', 1) = auth.uid()::text);
