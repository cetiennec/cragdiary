# Running Cragdiary on cragdiary.com, independent of NanoCorp

A step-by-step runbook to move the live site off the NanoCorp-managed stack and onto
accounts you own, served from `cragdiary.com`.

---

## 0. Status — done as of 2026-07-29

**The migration is complete.** Steps 1–7 below are kept as the record of how it was done and
as the rollback procedure; they are no longer instructions to follow.

| # | Was | Now | Verified by |
|---|-----|-----|-------------|
| 1 | Vercel under NanoCorp | Your own Vercel project, building `github.com/cetiennec/cragdiary` | GitHub Deployments on that repo track what's live |
| 2 | Neon `withered-fire-49669067`, `us-east-2` | Your own Neon, `ep-proud-shape-a2pf82sk`, **eu-central-1** | 3 users / 42 entries / 146 photos, matching the site |
| 3 | `api.nanocorp.so/…/send_email` | Resend (`src/lib/email.ts`) | commit e1aac92 |
| 4 | `origin` = nanocorp-hq | `origin` = cetiennec, `nanocorp` = retired mirror | `git remote -v` |
| 5 | Their edge proxy | `cragdiary.com` straight to Vercel | `server: Vercel` on the response |

**The trap this left behind:** for a day, `.env.local` still pointed at the *old* database
while the site ran on the new one. Comparing row counts against the live site is the only
reliable way to tell them apart — the env file is not evidence. If the two ever disagree
again, the site wins, and **do not restore an old dump over the live database.**

Still open: rotate `SESSION_SECRET` (NanoCorp held the old value and could otherwise mint
valid session cookies), and confirm `RESEND_API_KEY` is set in Vercel — nothing surfaces a
missing key until someone needs a password reset.

---

## 1. What NanoCorp currently provides

Five things, and only five:

| # | Thing | Where it lives today | Why it blocks you |
|---|-------|---------------------|-------------------|
| 1 | **Hosting** | A Vercel project owned by NanoCorp | You have no Vercel dashboard access — you can't add a domain |
| 2 | **Database** | Neon project `withered-fire-49669067`, host `ep-withered-pine-ajk7wi7p.c-3.us-east-2.aws.neon.tech` | Provisioned under NanoCorp's Neon org |
| 3 | **Email sending** | `src/lib/email.ts` → `https://api.nanocorp.so/internal/tools/send_email/execute` | Password resets and the feedback form go through their API |
| 4 | **Git repo** | `origin` = `github.com/nanocorp-hq/cragdiary` | Already mirrored to `github.com/cetiennec/cragdiary` ✅ |
| 5 | **Custom-domain proxy** | Their edge proxy in front of `cragdiary.nanocorp.app` | It rewrites `x-forwarded-host`, which is the only reason `next.config.ts` needs `allowedOrigins` |

**The good news:** there is no hidden dependency. Photos are stored as `bytea` in Postgres
(not in NanoCorp blob storage), there is no Stripe integration in the code, and no analytics
SDK. The app is a plain Next.js 16 + Postgres app. Migration is genuinely small.

**Current data size:** 3 users, 42 entries, 146 photos. The `photos` table is **75 MB**, which
dominates the database. Keep that number in mind for Step 2.

---

## 2. Target stack

| Concern | New home | Cost |
|---|---|---|
| Hosting | **Vercel**, your own account (Hobby) | Free |
| Database | **Neon**, your own account (Free plan) | Free |
| Email | **Resend**, your own account | Free (3,000/month) |
| Domain | **cragdiary.com**, your registrar | Already bought |
| Repo | `github.com/cetiennec/cragdiary` | Free |

Two notes before you commit to this:

- **Vercel Hobby is non-commercial.** Cragdiary is free to use, so you're fine. The day you
  charge for anything, you need Pro ($20/mo).
- **Neon Free gives 0.5 GB storage.** You're at ~75 MB of photos after 146 photos, so roughly
  **0.5 MB per photo**. That means about **1,000 photos before you hit the free ceiling.**
  See §9 for what to do about it.

---

## 3. Prerequisites

```bash
# Postgres client tools — you don't have them yet (psql isn't on your PATH)
brew install postgresql@17
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
psql --version   # should print 17.x
```

Also create accounts (all free, sign in with GitHub where offered):

- https://neon.tech
- https://vercel.com
- https://resend.com

> ⚠️ **Important:** your local `.env.local` currently points at the **production** database.
> Everything in Step 4 below writes to a *new* database, not that one. Don't repoint
> `.env.local` at prod for testing — it eats prod connection slots.

---

## 4. Step 1 — Own the database

### 4a. Create your Neon project

1. Neon console → **New Project**.
2. Name: `cragdiary`. Postgres version: **17**. Region: **AWS eu-central-1 (Frankfurt)** —
   you and your users are in Europe; the current DB is in `us-east-2`, so this also cuts
   latency.
3. Copy the connection string it shows you (the **pooled** one, it contains `-pooler`).

### 4b. Dump the old database

```bash
cd ~/GitHub/cragdiary

# Read the current prod URL without printing it to screen
export OLD_DB=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)

pg_dump "$OLD_DB" \
  --no-owner --no-acl --no-privileges \
  -Fc -f ~/cragdiary-backup-$(date +%F).dump

ls -lh ~/cragdiary-backup-*.dump   # expect ~75–90 MB
```

Keep this file. It is your rollback.

### 4c. Restore into your Neon project

```bash
# Paste YOUR new Neon connection string here
export NEW_DB='postgresql://neondb_owner:...@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require'

pg_restore --no-owner --no-acl -d "$NEW_DB" ~/cragdiary-backup-*.dump
```

### 4d. Verify the copy

```bash
psql "$NEW_DB" -c "select
  (select count(*) from users)   as users,
  (select count(*) from entries) as entries,
  (select count(*) from photos)  as photos;"
```

You should get **3 / 42 / 146** (or higher if you've added entries since). If the numbers
match, the database is done.

---

## 5. Step 2 — Own email sending

`src/lib/email.ts` is the only file that calls NanoCorp. It sends two things: password-reset
links and the feedback form. Both matter — without this, nobody can recover an account.

### 5a. Set up Resend

1. Resend → **Domains** → **Add Domain** → `cragdiary.com`.
2. It gives you 3–4 DNS records (a `MX`, a `TXT` for SPF, a `TXT` for DKIM). Add them at your
   registrar. Keep this tab open — you'll add Vercel's records in Step 5 too.
3. Wait for **Verified** (usually minutes, up to an hour).
4. **API Keys** → create one with **Sending access**. Copy it (starts with `re_`).

This lets you send *as* `noreply@cragdiary.com`. Your existing `cragdiary@pm.me` stays the
address people reply to — that's `FEEDBACK_EMAIL` and doesn't change.

### 5b. Replace the NanoCorp call

Rewrite `src/lib/email.ts`:

```ts
const RESEND_API = "https://api.resend.com/emails";

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Cragdiary <noreply@cragdiary.com>";
  if (!key) {
    console.error("email: RESEND_API_KEY not configured");
    return false;
  }

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error("email: send failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("email: request failed:", e);
    return false;
  }
}
```

The signature is unchanged, so the two call sites in `src/app/actions.ts` (password reset at
~line 797, feedback at ~line 1130) need no edits.

---

## 6. Step 3 — Point the code at cragdiary.com

Four files still hardcode `cragdiary.nanocorp.app` as a fallback.

**`next.config.ts`** — replace the NanoCorp proxy workaround:

```ts
    serverActions: {
      bodySizeLimit: "20mb",
      allowedOrigins: ["cragdiary.com", "www.cragdiary.com"],
    },
```

> On your own Vercel project with a real custom domain, `x-forwarded-host` will actually *be*
> `cragdiary.com`, so Next's CSRF check passes on its own and this line becomes redundant.
> Setting it correctly costs nothing and saves you a debugging session if you ever front the
> site with a proxy again.

**`src/app/actions.ts` (~line 761)** and **`src/app/layout.tsx` (~line 21)** — change both
fallbacks from `"https://cragdiary.nanocorp.app"` to `"https://cragdiary.com"`. `APP_URL` will
override them in production anyway, but the fallback is what runs if the env var is ever
missing — and on the reset-link path a wrong fallback emails people a dead link.

**`src/lib/i18n.ts`** — the "Add to Home Screen" instructions name the old domain in 4 places
(EN ~lines 327/333, FR ~lines 772/778). Replace `cragdiary.nanocorp.app` with `cragdiary.com`.

**`README.md`** — update the "Live at" line and the Deploy section.

Then commit:

```bash
git add -A
git commit -m "Move off NanoCorp: Resend email, cragdiary.com domain"
git push personal main
```

---

## 7. Step 4 — Own the hosting

1. Vercel → **Add New** → **Project** → **Import Git Repository**.
2. Authorize GitHub, pick **`cetiennec/cragdiary`** (your copy, not `nanocorp-hq`).
3. Framework preset: **Next.js**. Leave build settings at defaults.
4. **Before clicking Deploy**, expand **Environment Variables** and add:

| Key | Value |
|---|---|
| `DATABASE_URL` | your new Neon **pooled** connection string |
| `SESSION_SECRET` | **a fresh random string** — see note below |
| `ADMIN_PASSWORD` | a fresh password |
| `APP_URL` | `https://cragdiary.com` |
| `FEEDBACK_EMAIL` | `cragdiary@pm.me` |
| `RESEND_API_KEY` | your `re_...` key |
| `EMAIL_FROM` | `Cragdiary <noreply@cragdiary.com>` |

Note there is **no** `NANOCORP_TOKEN` and **no** `NANOCORP_COMPANY` — that's the point.

Generate secrets with:

```bash
openssl rand -base64 32
```

> **On `SESSION_SECRET`:** it signs the login cookies. Reusing the old value keeps everyone
> logged in through the move; generating a new one logs all 3 users out once. Generate a new
> one — the old value has been sitting in NanoCorp's environment, and "independent" should
> mean they can't mint valid sessions for your site. Three people logging in again is a fine
> price.

5. **Deploy.** You'll get a `cragdiary-xxxx.vercel.app` URL. Open it and check the site loads,
   photos render, and you can log in. Don't touch DNS until this passes.

---

## 8. Step 5 — Point cragdiary.com at it

1. Vercel project → **Settings** → **Domains** → add `cragdiary.com`, then add
   `www.cragdiary.com` and set it to redirect to the apex.
2. Vercel shows the records to create. At your registrar's DNS panel:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

   Use the exact values **Vercel shows you** — they occasionally change these.
3. Leave the Resend records from Step 5a in place. They don't conflict: Resend uses `MX`/`TXT`,
   Vercel uses `A`/`CNAME`.
4. Wait for propagation (minutes to a few hours). Check with:

```bash
dig +short cragdiary.com
dig +short www.cragdiary.com
```

5. Vercel issues the TLS certificate automatically once DNS resolves. The domain shows a green
   check when it's live.

---

## 9. Step 6 — Verify before cutting over

Walk through all of it on `https://cragdiary.com`:

- [ ] Home feed loads, photos display
- [ ] Log in with the new `ADMIN_PASSWORD`
- [ ] Create an entry **with a photo upload** (this exercises `sharp` + the 20 MB server-action limit)
- [ ] Public profile page, link-only entry, private entry — visibility still correct
- [ ] **Password reset** — request one, confirm the email arrives and the link works
- [ ] **Feedback form** — confirm it reaches `cragdiary@pm.me`
- [ ] Open it on your phone; "Add to Home Screen" and confirm the PWA launches
- [ ] `https://www.cragdiary.com` redirects to the apex

The two email checks are the ones people skip and regret. Do them.

---

## 10. Step 7 — Cut over and decommission

Only after Step 6 is fully green.

```bash
# Make your own repo the default remote
git remote rename origin nanocorp
git remote rename personal origin
git remote -v
```

Then, in order:

1. Put a redirect or a short "we've moved" note on the old site if you like — or just let it
   go stale. Anyone with a bookmark to `cragdiary.nanocorp.app` will otherwise hit an app
   writing to an abandoned database.
2. **Take a final dump of the old DB** (`pg_dump`, same command as 4b) so any entries written
   between your migration and cutover aren't lost. If there are new rows, restore just those
   tables into the new DB.
3. Once you're confident, ask NanoCorp to delete the company — or leave it dormant. Either way,
   **rotate `ADMIN_PASSWORD` and any credential that ever lived in their env**, which you
   already did in Step 4.
4. Remove `.nanocorp/project.json` from the repo, and delete the `nanocorp` remote.
   (`project.json` is gone as of 2026-07-29; the remote is kept for now as a bare mirror.)

> Done 2026-07-29, with one deviation: step 2's "final dump of the old DB" was taken
> (`~/cragdiary-backup-2026-07-29.dump`) but **not** restored — by then the new database was
> already live and ahead of it. The dumps are archives, not something to replay.

---

## 11. Gotchas and what to watch

**Photos in Postgres will become the problem.** 0.5 MB/photo in `bytea` means ~1,000 photos
fills Neon's free 0.5 GB, and every photo read is a database round-trip through
`/api/photos/[id]`. It works fine today at 146 photos. When it starts to hurt, move the blobs
to object storage (Cloudflare R2 has a generous free tier and no egress fees) and keep only
the key in Postgres. That's a separate project — don't bundle it into this migration.

**Neon free tier scales to zero.** After 5 minutes idle the compute suspends, and the next
request pays a cold start (~500 ms). For a personal journal that's fine. If it annoys you,
that's the $19/mo Launch plan.

**Server action body limit is 20 MB** (`next.config.ts`). Vercel's own limit on Hobby is 4.5 MB
for serverless function request bodies. Your client-side resizing in `src/lib/client-image.ts`
is what keeps uploads under that today — don't remove it. Test a large photo from a phone
specifically.

**Keep the CSP in sync.** `next.config.ts` sets `connect-src 'self'`. Resend is called
server-side, so no change needed. But if you ever add a client-side analytics or error
tracker, it will be silently blocked until you add its host there.

**Regional latency.** If you put Neon in Frankfurt, set the Vercel function region to
Frankfurt too (Project Settings → Functions → Region: `fra1`). Mismatched regions add ~100 ms
to every query.

---

## 12. Rollback

Nothing here touches the old stack until Step 7. If anything goes wrong:

1. Remove the domain from your Vercel project.
2. Point `cragdiary.com` DNS wherever you like, or leave it unresolved.
3. `cragdiary.nanocorp.app` is still running, still on the old database, unchanged.

Your `~/cragdiary-backup-*.dump` restores the data anywhere.
