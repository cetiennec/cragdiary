create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  bio text,
  visibility text not null default 'public'
    check (visibility in ('public','unlisted','private')),
  avatar bytea,
  avatar_type text,
  cover bytea,
  cover_type text,
  email text,
  wishlist_public boolean not null default true,
  created_at timestamptz not null default now()
);
-- Recovery email is unique (case-insensitive); nulls allowed for accounts
-- without one. Signup relies on this to reject duplicate emails.
create unique index if not exists users_email_unique
  on users (lower(email)) where email is not null;

create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
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
  starred boolean not null default false, -- legacy, superseded by star_level
  star_level integer not null default 0,
  country text,
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

create table if not exists follows (
  follower_id uuid not null references users(id) on delete cascade,
  followee_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id)
);

create table if not exists wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  location text,
  grade_max text,
  rating text,
  pitches integer,
  height_m integer,
  c2c_url text,
  note text,
  partners text,
  lat double precision,
  lon double precision,
  created_at timestamptz not null default now()
);
create index if not exists wishes_user_id_idx on wishes(user_id);
alter table wishes add column if not exists partners text;
alter table users add column if not exists wishlist_public boolean not null default true;
alter table entries add column if not exists starred boolean not null default false;
alter table entries add column if not exists country text;
alter table entries add column if not exists star_level integer not null default 0;

-- Sliding-window counters for throttling login / password-reset attempts by IP.
create table if not exists rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_bucket_idx on rate_limit_events(bucket, created_at);

-- Named wishlists. Every user has exactly one is_default list (never deletable,
-- initially "Ma liste", renamable). Wishes belong to a list.
create table if not exists wishlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  visibility text not null default 'public'
    check (visibility in ('public','unlisted','private')),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists wishlists_owner_idx on wishlists(owner_id);

alter table wishes add column if not exists wishlist_id uuid references wishlists(id) on delete cascade;
create index if not exists wishes_wishlist_idx on wishes(wishlist_id);

-- Collaborators on a shared list. A member (like the owner) can edit its
-- routes; only the owner can rename/delete/share the list.
create table if not exists wishlist_members (
  wishlist_id uuid not null references wishlists(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (wishlist_id, user_id)
);
create index if not exists wishlist_members_user_idx on wishlist_members(user_id);
