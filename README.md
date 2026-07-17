# cragdiary

A free, Notion-style journal for logging climbing days and multi-pitch routes. Not
performance/grade-tracking — an aesthetic, personal-diary experience: log a day, add
notes, photos, and the vibe of it.

Live at https://cragdiary.nanocorp.app

## Stack

- Next.js 16 (App Router), TypeScript, Tailwind CSS v4
- Postgres (Neon) via `pg` — entries and photos (photos stored as `bytea`, resized/
  compressed to WebP with `sharp` on upload, served through `/api/photos/[id]`)
- Multi-user accounts (scrypt password hashes, HMAC session cookies); per-entry
  and per-profile visibility (public / link-only / private)
- Single visual theme: Scrapbook/Carnet (see "Visual theme" below)

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

## Visual theme

The site ships with the warm Scrapbook/Carnet look only. A second "Minimal"
theme still exists in `src/app/globals.css` (`:root[data-theme="minimal"]`
variables) and the switcher component survives at
`src/components/ThemeToggle.tsx`. To bring the choice back:

1. In `src/app/layout.tsx`, re-import `ThemeToggle` and render
   `<ThemeToggle labels={t.themes} />` inside the header `<nav>`.
2. Replace `THEME_INIT_SCRIPT` with the localStorage-reading version (see git
   history of this file — commit that introduced "Single visual identity").
3. That's all: both themes' CSS variables are still maintained.
