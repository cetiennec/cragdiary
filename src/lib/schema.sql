create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  -- Unique without regard to case (migration 035): "Etienne" is kept as typed
  -- and "etienne" is then refused, since two accounts differing only in case
  -- would be an impersonation waiting to happen. The index is below, beside
  -- the email one it is modelled on.
  username text not null,
  display_name text not null,
  password_hash text not null,
  bio text,
  -- Two levels only (migration 037): listed, or reached by its link. A
  -- journal lives at /u/<username>, an address anyone can type, so a third
  -- "nobody at all" was never something the address could keep.
  visibility text not null default 'public'
    check (visibility in ('public','private')),
  avatar bytea,
  avatar_type text,
  cover bytea,
  cover_type text,
  email text,
  wishlist_public boolean not null default true,
  created_at timestamptz not null default now()
);
-- The username, unique whatever its case (migration 035).
create unique index if not exists users_username_unique on users (lower(username));

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
  -- Not the same three words as a profile's (migration 036): a day is reached
  -- by an unguessable id, so 'private' can mean "whoever I send the link to,
  -- and whoever I named with an @", and the middle rung goes to followers.
  visibility text not null default 'public'
    check (visibility in ('public','followers','private')),
  -- Fields the author chose not to show on the day (migration 040). The value
  -- is kept; only the row on the page goes. Hiding used to blank the column,
  -- which deleted what "show this again" was supposed to bring back.
  hidden_fields text[] not null default '{}',
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

-- Who put this photograph here (migration 039). Null on everything older,
-- which reads as "the entry's author" — the only person who could have.
alter table photos add column if not exists uploaded_by uuid references users(id) on delete set null;

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
-- Co-authors of a day (migration 039). One entry, written by two people who
-- were on the same rope, instead of two rows that start identical and drift.
--
-- An invitation before it is a permission: the row appears `pending` when the
-- author offers it and grants nothing until it is `accepted`. `in_journal` is
-- the co-author's separate decision to show the day among their own entries
-- rather than only in the tray at the foot of their profile.
--
-- Deliberately not the same thing as being @-named in `partners`: a mention
-- opens the day to you and lends your photos to it, and that is unchanged. A
-- co-author may edit the day itself. Only the author may set its visibility or
-- delete it.
create table if not exists entry_authors (
  entry_id uuid not null references entries(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  in_journal boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);
create index if not exists entry_authors_user_idx on entry_authors(user_id, status);

-- Migration 041. Two entries link themselves when they share a date and an @
-- mention either way; nothing records that, so nothing could undo it. This is
-- the refusal: one row per pair, always the smaller id first, so the pair is
-- the key and neither climber owns it. Either of them may break the link, and
-- it breaks for both — the mention stays, the borrowed photographs go.
create table if not exists entry_unlinks (
  entry_id uuid not null references entries(id) on delete cascade,
  other_entry_id uuid not null references entries(id) on delete cascade,
  unlinked_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (entry_id, other_entry_id),
  check (entry_id < other_entry_id)
);
create index if not exists entry_unlinks_other_idx on entry_unlinks(other_entry_id);

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
  type text not null,                                             -- follow | follow_request | follow_accepted | tagged | wishlist_invite | wishlist_add | wish_tagged | c2c_new | coauthor_invite | coauthor_accepted
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

-- A personal site linked from the profile (migration 033), stored already
-- normalised to an http(s) URL by `updateProfile`.
alter table users add column if not exists website text;

-- What may be sent by email, and when the last digest went out (migration
-- 034). Tags default on — it is the notification the site already shows,
-- arriving where it can be seen; the digest defaults off, being something you
-- ask for rather than something you are given.
alter table users add column if not exists email_tags boolean not null default true;
alter table users add column if not exists email_digest boolean not null default false;
alter table users add column if not exists digest_sent_at timestamptz;

-- Which camptocamp image a photo came from (migration 028), so re-syncing an
-- already-imported day adds only what's missing instead of duplicating the
-- gallery. Null on photos uploaded by hand, and on anything imported before.
alter table photos add column if not exists c2c_filename text;

-- A photo imported from camptocamp that is someone else's (migration 044):
-- who to credit, which image page to link, and the image type the licence
-- follows from. Null on the importer's own photos and on every upload.
alter table photos add column if not exists c2c_image_id integer;
alter table photos add column if not exists c2c_credit text;
alter table photos add column if not exists c2c_image_type text;

-- The topo the outing was climbed on (migration 030). `c2c_url` holds the
-- outing — the story — and the route's own page was lost on import.
alter table entries add column if not exists c2c_route_url text;

-- The camptocamp outing a day was *published* as (migration 042) — the other
-- direction from `c2c_url`, which is the outing a day was imported from. Set
-- only by the publish proof of concept; see docs/publier-sur-camptocamp.md.
alter table entries add column if not exists c2c_outing_id integer;

-- Beta testers (migration 043): who sees what is half-built. The admin is one
-- by definition and carries no flag — see `isBetaUser` in src/lib/beta.ts.
alter table users add column if not exists beta boolean not null default false;

-- Indoor climbing gyms (migration 031), for the Cragseeker map layer. A
-- periodic snapshot rather than a live query: gyms barely change, and asking
-- Overpass fresh on every request turned out to be unreliable from Vercel's
-- own network. Refreshed wholesale by scripts/refresh-climbing-gyms.mjs
-- (scheduled monthly in CI) — every row is replaced each run, so a closed
-- gym simply stops being written rather than needing its own cleanup.
create table if not exists climbing_gyms (
  osm_id bigint primary key,
  name text not null,
  lat double precision not null,
  lon double precision not null,
  -- Bouldering only, when OSM says so; null otherwise (see lib/seeker/gyms.ts).
  bouldering boolean,
  website text,
  -- What a gym's card shows beside its name (migration 032). Assembled from
  -- OSM's own tags at refresh time; null where OSM had nothing to say.
  address text,
  opening_hours text,
  phone text,
  updated_at timestamptz not null default now()
);
-- Not a real spatial index, just enough to narrow a box before the app
-- refines to a circle — the table is a few thousand rows, a seq scan would
-- be fine too, this just keeps the habit for whenever it grows.
create index if not exists climbing_gyms_lat_lon_idx on climbing_gyms(lat, lon);

-- The EPI register (migration 038): the gear you climb on, when it was made,
-- when it went into service, and every time someone has looked at it properly.
-- Retired items stay — a register whose purpose is traceability must be able to
-- say what was in service last year, including what has since been destroyed.
create table if not exists gear (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  brand text,
  model text,
  serial text,
  -- Textiles age on two clocks: from manufacture, and from first use. Whichever
  -- runs out first is the one that matters — see src/lib/gear.ts.
  made_on date,
  bought_on date,
  first_used_on date,
  notes text,
  retired_on date,
  retired_reason text,
  created_at timestamptz not null default now()
);
create index if not exists gear_user_idx on gear(user_id, created_at desc);

-- One row per periodic inspection: EN 365 asks for at least one a year, by
-- someone competent to give it. The verdict is theirs, never the app's.
create table if not exists gear_checks (
  id uuid primary key default gen_random_uuid(),
  gear_id uuid not null references gear(id) on delete cascade,
  checked_on date not null,
  verdict text not null check (verdict in ('ok','watch','retire')),
  inspector text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists gear_checks_gear_idx on gear_checks(gear_id, checked_on desc);
