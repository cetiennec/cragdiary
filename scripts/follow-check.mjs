// Drives follow requests and follower removal in a real browser: three fresh
// accounts, approval on and off, accept / decline / withdraw / remove.
// Point it at a throwaway database — it signs accounts up, and signups are
// rate-limited per IP, so clear the counters between runs:
//   psql "$DATABASE_URL" -c "delete from rate_limit_events"
//   node scripts/follow-check.mjs [baseUrl]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3111";
const stamp = Date.now().toString(36).slice(-5);
const names = { a: `alice${stamp}`, b: `bob${stamp}`, c: `carol${stamp}` };

const browser = await chromium.launch();
let failures = 0;

function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
}

async function signUp(username) {
  // French, so the labels asserted below are the ones the page renders.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    locale: "fr-FR",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
  await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
  await page.goto(`${base}/signup`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="display_name"]', username);
  await page.fill('input[name="password"]', "correct horse battery");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 20000 });
  return page;
}

// <details open> already shows the panel when a request is waiting: clicking
// the summary then would close it.
async function openPanel(page) {
  await page.waitForSelector(".profile-followers");
  if (!(await page.locator(".profile-followers").evaluate((d) => d.open))) {
    await page.locator(".profile-followers summary").click();
  }
}

// The follow button's label is the whole state machine, so read it back.
async function followButton(page, who) {
  await page.goto(`${base}/u/${who}`);
  return (await page.locator(".btn-follow").innerText()).trim();
}

async function clickFollow(page, who) {
  await page.goto(`${base}/u/${who}`);
  await page.click(".btn-follow");
  await page.waitForTimeout(600);
}

const alice = await signUp(names.a);
const bob = await signUp(names.b);
const carol = await signUp(names.c);

// --- Approval is on by default: even the first follower has to ask. ---
check(
  "approval is on for a new account",
  (await (async () => {
    await alice.goto(`${base}/u/${names.a}`);
    await openPanel(alice);
    return alice.locator(".follow-toggle").innerText();
  })()).includes("approuvés"),
  true
);

// Alice opens her door for a moment, so the immediate path is covered too.
await alice.click(".follow-toggle");
await alice.waitForTimeout(600);
check("bob sees a plain Follow button", await followButton(bob, names.a), "Suivre");
await clickFollow(bob, names.a);
check("bob follows straight away", await followButton(bob, names.a), "Suivi ✓");

await alice.goto(`${base}/u/${names.a}`);
await openPanel(alice);
check("alice has 1 follower", await alice.locator(".follower-list .follower-row").count(), 1);

// --- And closes it again. ---
await alice.click(".follow-toggle");
await alice.waitForTimeout(600);
check(
  "approval is back on",
  (await alice.locator(".follow-toggle").innerText()).includes("approuvés"),
  true
);
check(
  "bob is still a follower",
  await alice.locator(".follower-list .follower-row").count(),
  1
);

// --- Carol now has to ask. ---
check("carol must ask", await followButton(carol, names.a), "Demander à suivre");
await clickFollow(carol, names.a);
check(
  "carol's request is pending",
  await followButton(carol, names.a),
  "Demande envoyée — cliquer pour annuler"
);
// Alice sees the request, in the panel and in her notifications.
await alice.goto(`${base}/u/${names.a}`);
check("the panel flags 1 request", await alice.locator(".follower-badge").innerText(), "1");
await alice.goto(`${base}/notifications`);
check(
  "the notification offers an answer",
  await alice.locator(".notif-row .follower-accept").count(),
  1
);

// --- Decline: the row goes away and carol is back to square one. ---
await alice.click(".notif-row .follower-remove");
await alice.waitForTimeout(800);
check("carol may ask again", await followButton(carol, names.a), "Demander à suivre");
await alice.goto(`${base}/u/${names.a}`);
check("no request left", await alice.locator(".follower-badge").count(), 0);

// --- Accept, from the followers panel this time. ---
await clickFollow(carol, names.a);
await alice.goto(`${base}/u/${names.a}`);
await openPanel(alice);
await alice.click(".follower-accept");
await alice.waitForTimeout(800);
check("carol is following", await followButton(carol, names.a), "Suivi ✓");
await alice.goto(`${base}/u/${names.a}`);
await openPanel(alice);
check("alice has 2 followers", await alice.locator(".follower-list .follower-row").count(), 2);

// Carol is told her request went through.
await carol.goto(`${base}/notifications`);
check(
  "carol was notified",
  (await carol.locator(".notif-row").first().innerText()).includes("accepté"),
  true
);

// --- Carol screens too (the default), so bob has to ask her as well. ---
check("bob must ask carol", await followButton(bob, names.c), "Demander à suivre");

// --- Withdrawing your own request, before it's answered. ---
await alice.goto(`${base}/u/${names.a}`);
await openPanel(alice);
await alice.locator(".follower-row", { hasText: names.b }).locator(".follower-remove").click();
await alice.waitForTimeout(800);
await clickFollow(bob, names.a); // approval is on, so this only asks
check("bob's request is pending", await followButton(bob, names.a), "Demande envoyée — cliquer pour annuler");
await clickFollow(bob, names.a); // clicking again withdraws it
check("bob withdrew", await followButton(bob, names.a), "Demander à suivre");
await alice.goto(`${base}/u/${names.a}`);
check("alice sees no request", await alice.locator(".follower-badge").count(), 0);

// --- Remove a follower: carol, the one left. ---
await alice.goto(`${base}/u/${names.a}`);
await openPanel(alice);
await alice.locator(".follower-row", { hasText: names.c }).locator(".follower-remove").click();
await alice.waitForTimeout(800);
await openPanel(alice);
check("alice has no followers left", await alice.locator(".follower-list .follower-row").count(), 0);
check("carol has to ask again", await followButton(carol, names.a), "Demander à suivre");

await browser.close();
console.log(failures === 0 ? "OK — follow requests and removal behave" : `FAIL — ${failures} checks`);
process.exit(failures === 0 ? 0 : 1);
