# Where the photos live, and what each option costs

Written 2026-08-10. Prices are list prices at that date, in USD unless stated;
they change. Everything here is about **photos** — the rest of the data (entries,
users, wishlists) is a few megabytes of text and will not matter for years.

## Where we are today

Photos are rows in Postgres: `photos.data` holds the full image and
`photos.thumb` the card-sized derivative, both AVIF.

Measured on the real table (40 photos):

| | size |
|---|---|
| full image, average | **192 kB** |
| thumbnail, average | 131 kB (900 px — new ones are 640 px, ~95 kB) |
| a photo, all in | **~290 kB** |
| the `photos` table, with its overhead | 19 MB for 40 photos |

So roughly **0.3 MB per photo**, and a day out with 5 photos costs ~1.5 MB.
The database is Neon, region Frankfurt.

### What that means as it grows

| photos | data | what it is |
|---|---|---|
| 1 000 | ~0.3 GB | one climber, two seasons |
| 10 000 | ~3 GB | a dozen active climbers |
| 100 000 | ~29 GB | a small community |
| 1 000 000 | ~290 GB | a real site |

## The options

### 1. Stay in Postgres (Neon)

Neon bills storage and compute separately. The free plan includes 0.5 GB; the
Launch plan is $19/month with 10 GB included and about $1.50 per extra GB-month.

| photos | storage | monthly |
|---|---|---|
| 1 000 | 0.3 GB | free plan |
| 10 000 | 3 GB | free plan is exceeded → $19 |
| 100 000 | 29 GB | $19 + ~19 GB extra ≈ **$47** |
| 1 000 000 | 290 GB | $19 + ~280 GB ≈ **$440** |

There is a second cost that the table above hides: **backups and branches**.
A database branch is copy-on-write, so branching is cheap, but point-in-time
history retains changed pages — a table of large binaries makes that history
expensive. And every `pg_dump` you take is the size of the images.

**Verdict.** Fine to about 10 000 photos. Beyond that you are paying database
prices — replication, WAL, backups, connection-pooled compute — for bytes that
never change and are never queried.

### 2. Object storage + CDN (Vercel Blob, Cloudflare R2, S3)

The image bytes move to a store built for them; the database keeps a URL.

| | storage / GB-month | egress | notes |
|---|---|---|---|
| **Cloudflare R2** | $0.015 | **free** | no egress charge at all |
| **Vercel Blob** | ~$0.023 | ~$0.05/GB | one dashboard, one bill |
| **AWS S3** | $0.023 | $0.09/GB | cheapest storage, dearest egress |

At 100 000 photos (29 GB): **R2 ≈ $0.44/month**, Blob ≈ $0.67 + traffic,
S3 ≈ $0.67 + traffic. At a million photos (290 GB): **R2 ≈ $4.35/month**.

That is not a rounding error against $47 and $440 — it is two orders of
magnitude. Egress is what decides between them: a photo site serves its images
far more often than it stores them, which is why R2's free egress matters more
than its storage price.

**What it costs to do.** This is the real number. The work is:

- a `photos.url` column beside `data`, written by new uploads;
- upload straight from the browser to the store (signed URL), which also
  removes the current 20 MB server-action body limit;
- serve from the CDN instead of `/api/photos/[id]`;
- **keep the privacy model** — this is the hard part. Today a private photo is
  gated by a database read on every request. An object URL is not. Either the
  private ones stay behind our route (signed, short-lived URLs) or private
  entries keep their photos in Postgres;
- a migration that moves the existing rows, run in batches, with the old column
  kept until it is proven.

Call it two to three days of careful work, most of it in the privacy gate and
the backfill.

### 3. Keep only derivatives

Independent of where the bytes live: today we store a 1400–1600 px image and a
thumbnail. If the full-size original is not the product, storing a single
1280 px version would cut the bill by roughly 40% for one afternoon of work.
Cheaper than a migration, and it buys time rather than solving anything.

### 4. Don't host them at all

For imported days, we already do this: camptocamp's photos are shown from
camptocamp (see the borrowed-photos strip). It costs nothing and stays in step
with their owner's choices. It only works for photos that already live
somewhere public.

## What I would do

1. **Now, nothing.** At the current size the database is the right place: one
   system, one backup, one privacy gate that is known to be correct.
2. **Watch one number**: the size of the `photos` table.
   `select pg_size_pretty(pg_total_relation_size('photos'))`. When it passes
   **5 GB**, or when a Neon bill arrives that is mostly storage, it is time.
3. **Then move to R2**, and only for public and unlisted photos at first —
   private ones can stay in Postgres, where the existing gate already works.
   Free egress is what makes it the right target for an image-heavy site.
4. **Never** move photos and change the privacy model in the same week.

## The number to watch

```sql
select count(*)                                     as photos,
       pg_size_pretty(sum(length(data)))            as originals,
       pg_size_pretty(pg_total_relation_size('photos')) as table_total
from photos;
```
