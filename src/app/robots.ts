import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/email-notifications";

/**
 * What a crawler may read. The rule is the site's own: public days on public
 * journals, and the pages that explain the place. Everything behind a login,
 * everything that only makes sense to the person it belongs to, and everything
 * that is really an API stays out — a `disallow` here costs a crawler nothing
 * and keeps the index made of pages worth landing on.
 *
 * Pages whose visibility depends on who is asking say so for themselves, with
 * `robots: { index: false }` in their own metadata (see the entry page and the
 * profile). This file is the coarse net; those are the fine one.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/notifications",
        "/login",
        "/signup",
        "/forgot",
        "/reset/",
        "/unsubscribe",
        "/import",
        // The editor, which redirects to a login for anyone else anyway.
        "/entries/*/edit",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
