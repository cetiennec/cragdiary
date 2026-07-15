# cragdiary

A free, Notion-style journal for logging climbing days and multi-pitch routes. Not
performance/grade-tracking — an aesthetic, personal-diary experience: log a day, add
notes, photos, and the vibe of it.

Live at https://cragdiary.nanocorp.app

## Stack

- Next.js 16 (App Router), TypeScript, Tailwind CSS v4
- Postgres (Neon) via `pg` — entries and photos (photos stored as `bytea`, resized/
  compressed to WebP with `sharp` on upload, served through `/api/photos/[id]`)
- Single-owner auth: a shared password (`ADMIN_PASSWORD`) gates posting; the feed
  itself is public/read-only for anyone with the link
- Two switchable visual themes (Scrapbook / Minimal), toggled client-side and
  persisted in `localStorage`

## Local development

```bash
npm install
npm run dev
```

Requires a `.env.local` with:

```
DATABASE_URL=...
SESSION_SECRET=...   # random string, signs the login session cookie
ADMIN_PASSWORD=...   # the login password for posting entries
```

Schema lives in `src/lib/schema.sql` — apply it once against the database with any
Postgres client.

## Deploy

Push to `main`; Vercel auto-deploys (managed via NanoCorp — see `.nanocorp/project.json`).
