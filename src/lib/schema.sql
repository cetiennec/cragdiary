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

-- Small derivative served to card and profile grids; null on older rows, in
-- which case the photo route falls back to the full image.
-- Columns added after the initial schema; kept as alters so an existing
-- database can be brought up to date by re-running this file.
alter table photos add column if not exists width integer;
alter table photos add column if not exists height integer;
alter table photos add column if not exists caption text;

-- Small derivative served to card and profile grids; null on older rows, in
-- which case the photo route falls back to the full image.
alter table photos add column if not exists thumb bytea;

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

-- A follow is accepted straight away unless the followee asks to approve them
-- (users.approve_followers), in which case the row waits as 'pending'. Every
-- read of this table filters on status: a request is not an audience.
create table if not exists follows (
  follower_id uuid not null references users(id) on delete cascade,
  followee_id uuid not null references users(id) on delete cascade,
  status text not null default 'accepted'
    check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id)
);

-- In-app notifications: someone followed you, tagged you on an outing,
-- invited you to a wishlist, or added to a shared wishlist.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,   -- recipient
  actor_id uuid references users(id) on delete cascade,           -- who triggered it
  type text not null,                                             -- follow | follow_request | follow_accepted | tagged | wishlist_invite | wishlist_add
  data jsonb,                                                     -- {entry_id, wishlist_id, list_name, wish_title}
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);

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
-- Parking carried over from Cragseeker: camptocamp's access waypoint.
alter table wishes add column if not exists parking_lat double precision;
alter table wishes add column if not exists parking_lon double precision;
alter table wishes add column if not exists parking_name text;
alter table users add column if not exists wishlist_public boolean not null default true;
-- Bumping this invalidates every session token issued before the bump.
alter table users add column if not exists session_version integer not null default 0;
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

-- Follow requests (migration 026). The column is added separately for
-- databases whose `follows` predates it; the check has no "if not exists".
alter table follows add column if not exists status text not null default 'accepted';
do $$ begin
  alter table follows add constraint follows_status_check
    check (status in ('pending','accepted'));
exception when duplicate_object then null;
end $$;
-- When on, a new follower waits as 'pending' until you accept. On by default
-- (migration 029): being followed is not the same as being read, and the
-- setting is one click away for anyone who wants the open door.
alter table users add column if not exists approve_followers boolean not null default false;
alter table users alter column approve_followers set default true;

-- Camptocamp account linked to the profile (migration 027): shown under the
-- bio, and what "sync with c2c" imports from.
alter table users add column if not exists c2c_profile_id integer;

-- Which camptocamp image a photo came from (migration 028), so re-syncing an
-- already-imported day adds only what's missing instead of duplicating the
-- gallery. Null on photos uploaded by hand, and on anything imported before.
alter table photos add column if not exists c2c_filename text;
