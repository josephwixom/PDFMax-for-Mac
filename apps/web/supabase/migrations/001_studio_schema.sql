-- ============================================================
-- PDF Max Studio — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── 1. Projects ────────────────────────────────────────────────
create table if not exists projects (
    id          uuid primary key default uuid_generate_v4(),
    name        text not null,
    description text,
    owner_id    text not null,           -- reviewer UUID (stored in localStorage)
    created_at  timestamptz default now()
);

alter table projects enable row level security;
-- Public access policy (adjust to auth.uid() if you add Auth later)
create policy "public read projects"  on projects for select using (true);
create policy "public write projects" on projects for insert with check (true);
create policy "public delete projects" on projects for delete using (true);

-- ── 2. Project Files ──────────────────────────────────────────
create table if not exists project_files (
    id            uuid primary key default uuid_generate_v4(),
    project_id    uuid references projects(id) on delete cascade,
    name          text not null,
    storage_path  text not null,
    version       int  default 1,
    uploaded_by   text not null,         -- reviewer UUID
    uploaded_at   timestamptz default now()
);

alter table project_files enable row level security;
create policy "public read files"  on project_files for select using (true);
create policy "public write files" on project_files for insert with check (true);
create policy "public delete files" on project_files for delete using (true);

-- ── 3. Sessions ───────────────────────────────────────────────
create table if not exists sessions (
    id          uuid primary key default uuid_generate_v4(),
    file_id     uuid references project_files(id) on delete cascade,
    name        text,
    status      text not null default 'open' check (status in ('open', 'closed')),
    created_by  text not null,           -- reviewer UUID
    created_at  timestamptz default now(),
    closed_at   timestamptz
);

alter table sessions enable row level security;
create policy "public read sessions"  on sessions for select using (true);
create policy "public write sessions" on sessions for insert with check (true);
create policy "public update sessions" on sessions for update using (true);

-- ── 4. Session Markups ────────────────────────────────────────
create table if not exists session_markups (
    id           uuid primary key default uuid_generate_v4(),
    session_id   uuid references sessions(id) on delete cascade,
    page_number  int not null,
    markup_data  jsonb not null,         -- Fabric.js / drawing JSON
    author_id    text not null,          -- reviewer UUID
    author_name  text not null,
    author_color text not null,
    status       text not null default 'open'
                 check (status in ('open', 'accepted', 'rejected', 'question')),
    created_at   timestamptz default now(),
    updated_at   timestamptz default now()
);

alter table session_markups enable row level security;
create policy "public read markups"   on session_markups for select using (true);
create policy "public insert markups" on session_markups for insert with check (true);
create policy "public update markups" on session_markups for update using (true);
create policy "public delete markups" on session_markups for delete using (true);

-- ── 5. Realtime — enable on session_markups ──────────────────
-- Run this separately in SQL editor after above succeeds:
alter publication supabase_realtime add table session_markups;
alter publication supabase_realtime add table sessions;
