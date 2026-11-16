// Gym websites, checked before they reach a Cragseeker card. OpenStreetMap's
// `website` tag is right when it is written and drifts after: chains move their
// gym pages (blockout.fr/bo-lyon → /lyon/), drop subdomains
// (didot.arkose.com → arkose.com/didot), and gyms close. A November check of
// 211 gyms around a dozen cities found 1 in 12 links dead.
//
// For each link: keep it if it answers. If not, read the site's home page (or
// the parent domain's) and pick the link on it that names this gym, taken from
// the dead address's own words ("didot", "lyon", "chambly"). Failing that, the
// home page itself, which beats a 404. A link with nothing behind it at all
// comes back null: the site is gone, and the refresh drops the gym with it.
//
//   node scripts/gym-links.mjs <url> [<url>…]    # try the repair on some links

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const TIMEOUT_MS = 12_000;

// Words in a gym's address that say nothing about which gym it is.
const GENERIC = new Set(
  (
    "www com fr be ch de uk co org net html php page pages index home accueil " +
    "escalade climbing klettern klimmen salle sala halle hall gym gyms bloc block " +
    "boulder bouldering centre center centres centers nos our locations location " +
    "new nouveau blog news actus club ecole school serveis services rocodrom mur wall " +
    "klimmuur kletterhalle boulderhalle"
  ).split(" ")
);

/**
 * Does the page answer? A site that turns robots away (401, 403, 429) or is
 * briefly down (503) is there for a person, so it counts as alive.
 */
async function answers(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ok = res.ok || [401, 403, 429, 503].includes(res.status);
      const body = ok && (res.headers.get("content-type") ?? "").includes("html") ? await res.text() : "";
      if (ok) return { ok: true, url: res.url || url, body };
      // A real "not here" is final; anything else is worth a second try.
      if (res.status === 404 || res.status === 410) return { ok: false };
    } catch {
      // DNS, refused, timeout: try once more before calling it gone.
    }
  }
  return { ok: false };
}

/**
 * The words of a dead address that name its gym: the subdomain and the path,
 * less the generic words and the brand itself ("sportoase" on sportoase.be
 * names every one of their centres, not this one).
 */
function tokensOf(url, withSub) {
  const { hostname, pathname } = new URL(url);
  const labels = hostname.split(".");
  const brand = labels.length >= 2 ? labels[labels.length - 2] : "";
  // The subdomain names the gym only once it is gone (didot.arkose.com,
  // read from arkose.com); on its own site it names the site.
  const sub = withSub && labels.length > 2 && labels[0] !== "www" ? [labels[0]] : [];
  const path = pathname.split("/").filter(Boolean);
  return [...new Set(
    [...sub, ...path]
      .flatMap((part) => part.toLowerCase().split(/[^a-z0-9à-ÿ]+/))
      .filter((w) => w.length >= 4 && !GENERIC.has(w) && w !== brand && !/^\d+$/.test(w))
  )];
}

const flat = (s) => s.toLowerCase().replace(/[^a-z0-9à-ÿ]/g, "");
const ASSET = /\.(css|js|mjs|json|xml|png|jpe?g|gif|svg|webp|ico|pdf|woff2?)$/i;

/** Home pages worth reading: the site's own, then its parent domain's. */
function homesOf(url) {
  const { protocol, hostname } = new URL(url);
  const labels = hostname.split(".");
  const homes = [`https://${hostname}/`];
  if (protocol === "http:") homes.push(`http://${hostname}/`);
  if (labels.length > 2) {
    const parent = labels.slice(1).join(".");
    homes.push(`https://${parent}/`, `https://www.${parent}/`);
  }
  return [...new Set(homes)];
}

/** The link on a home page that best names the gym, by the dead address's words. */
function bestLink(home, body, tokens, dead) {
  const deadSegments = new URL(dead).pathname.toLowerCase().split("/").filter(Boolean);
  if (!tokens.length || !body) return null;
  const base = new URL(home);
  const scored = [];
  for (const [, href] of body.matchAll(/href="([^"#]+)"/gi)) {
    let link;
    try {
      link = new URL(href, base);
    } catch {
      continue;
    }
    // Same site only: a Facebook page that says "stratford" is not the gym's site.
    const sameSite =
      link.hostname === base.hostname ||
      link.hostname.endsWith(`.${base.hostname.replace(/^www\./, "")}`) ||
      base.hostname.endsWith(`.${link.hostname.replace(/^www\./, "")}`);
    if (!sameSite || !/^https?:$/.test(link.protocol) || ASSET.test(link.pathname)) continue;
    let path;
    try {
      path = decodeURIComponent(link.pathname).toLowerCase();
    } catch {
      path = link.pathname.toLowerCase();
    }
    // "pont-de-sevres" is "pontdesevres" written out.
    const hits = tokens.filter((tok) => flat(path).includes(flat(tok))).length;
    // Then the page that kept more of the old address's shape
    // (/locations/… over /events/…), then the shortest: /lyon/ before
    // /actus/lyon-block-tour/.
    const shape = path.split("/").filter((seg) => deadSegments.includes(seg)).length;
    if (hits > 0) scored.push({ url: link.href, hits, shape, len: path.length });
  }
  scored.sort((a, b) => b.hits - a.hits || b.shape - a.shape || a.len - b.len);
  return scored[0]?.url ?? null;
}

/**
 * A working address for a gym's website, and how it was found. `url: null`
 * means nothing answered at all.
 */
export async function repairWebsite(website) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).href;
  } catch {
    return { url: null, how: "unreadable" };
  }
  if ((await answers(url)).ok) return { url, how: "ok" };

  const deadHost = new URL(url).hostname;
  for (const home of homesOf(url)) {
    const page = await answers(home);
    if (!page.ok) continue;
    const tokens = tokensOf(url, new URL(page.url).hostname !== deadHost);
    const found = bestLink(page.url, page.body, tokens, url);
    if (found && found !== url && (await answers(found)).ok) return { url: found, how: "moved" };
    return { url: page.url, how: "home" };
  }
  return { url: null, how: "dead" };
}

/** Repairs every gym's website, a few at a time. Returns counts by outcome. */
export async function repairAll(gyms, concurrency = 24) {
  const counts = { ok: 0, moved: 0, home: 0, dead: 0, unreadable: 0 };
  let next = 0;
  async function worker() {
    while (next < gyms.length) {
      const gym = gyms[next++];
      const { url, how } = await repairWebsite(gym.website);
      counts[how] += 1;
      if (how !== "ok") console.log(`  ${how.padEnd(5)} ${gym.name}: ${gym.website}${url ? ` → ${url}` : ""}`);
      gym.website = url;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const url of process.argv.slice(2)) {
    const { url: fixed, how } = await repairWebsite(url);
    console.log(`${how.padEnd(5)} ${url}${fixed && fixed !== url ? ` → ${fixed}` : ""}`);
  }
}
