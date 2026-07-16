create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  bio text,
  is_public boolean not null default true,
  avatar bytea,
  avatar_type text,
  cover bytea,
  cover_type text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entry_date date not null,
  month_only boolean not null default false,
  crag text not null,
  location text,
  style text,
  grade_max text,
  rating text,
  orientation text,
  equipment text,
  pitches integer,
  height_m integer,
  routes text,
  partners text,
  notes text,
  c2c_url text,
  c2c_summary text,
  pitch_notes jsonb,
  lat double precision,
  lon double precision,
  show_pins boolean not null default true,
  visibility text not null default 'public'
    check (visibility in ('public','unlisted','private')),
  created_at timestamptz not null default now()
);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  content_type text not null,
  data bytea not null,
  position integer not null default 0,
  size text not null default 'm',
  align text,
  para integer,
  created_at timestamptz not null default now()
);

create index if not exists photos_entry_id_idx on photos(entry_id);
create index if not exists entries_entry_date_idx on entries(entry_date desc);
create index if not exists entries_user_id_idx on entries(user_id);

create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
