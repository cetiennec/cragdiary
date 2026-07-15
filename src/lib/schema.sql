create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  bio text,
  created_at timestamptz not null default now()
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entry_date date not null,
  crag text not null,
  routes text,
  partners text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  content_type text not null,
  data bytea not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists photos_entry_id_idx on photos(entry_id);
create index if not exists entries_entry_date_idx on entries(entry_date desc);
create index if not exists entries_user_id_idx on entries(user_id);
