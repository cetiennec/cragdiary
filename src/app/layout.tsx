import type { Metadata, Viewport } from "next";
import { Geist, Fraunces } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin-stats";
import { getDict } from "@/lib/i18n";
import { unreadCount } from "@/lib/notifications";
import { logout, setLocale } from "./actions";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://cragdiary.com"),
  title: "Cragdiary",
  description: "A free, Notion-style journal for climbing days.",
  openGraph: {
    siteName: "Cragdiary",
    type: "website",
  },
  // Declaring `icons` at all disables Next's icon file convention, so every rel
  // has to be listed here — with only `apple` set, no <link rel="icon"> was
  // emitted and Safari fell back to probing /favicon.ico.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Cragdiary",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#f3e8d8",
};

// Single visual identity: the scrapbook/carnet theme. See README "Visual theme"
// for how to bring the theme toggle back.
const THEME_INIT_SCRIPT = `document.documentElement.setAttribute('data-theme', 'scrapbook');`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [user, { locale, t }] = await Promise.all([currentUser(), getDict()]);
  const notifCount = user ? await unreadCount(user.id) : 0;

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${fraunces.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="site-title">
              Cragdiary
            </Link>
            <nav className="site-nav">
              <Link href="/">{t.nav.feed}</Link>
              <Link href="/climbers">{t.nav.climbers}</Link>
              {user && (
                <>
                  <Link href={`/u/${user.username}`}>{t.nav.myJournal}</Link>
                  <Link href={`/u/${user.username}#wishlist`}>{t.nav.myWishlist}</Link>
                </>
              )}
              {/* Only the person who runs the site, and only if the site has
                  been told who that is. */}
              {isAdmin(user?.username) && <Link href="/admin">{t.admin.navLabel}</Link>}
              {/* Cragseeker sits where "New entry" used to: open to everyone,
                  logged in or not. */}
              <Link href="/cragseeker">{t.seeker.navLabel}</Link>
              {user ? (
                <>
                  <form action={logout}>
                    <button type="submit">{t.nav.logout}</button>
                  </form>
                  <Link
                    href="/notifications"
                    className="round-btn notif-bell"
                    title={t.nav.notifications}
                    aria-label={t.nav.notifications}
                  >
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    {notifCount > 0 && <span className="notif-badge">{notifCount}</span>}
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/login">{t.nav.login}</Link>
                  <Link href="/signup">{t.nav.signup}</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <Link href="/feedback" className="feedback-fab" title={t.feedback.title}>
          💬 {t.feedback.linkLabel}
        </Link>
        <footer className="site-footer">
          <p className="footer-tagline">{t.footer}</p>
          <p className="footer-links">
            <Link href="/credits">{t.credits.linkLabel}</Link> ·{" "}
            <Link href="/privacy">{t.privacy.linkLabel}</Link> ·{" "}
            <Link href="/legal">{t.legal.linkLabel}</Link> ·{" "}
            <Link href="/feedback">{t.feedback.linkLabel}</Link> ·{" "}
            <Link href="/install">{t.install.linkLabel}</Link>
            {user && (
              <>
                {" · "}
                {/* Re-opens the welcome tour, which was otherwise a one-time
                    thing nobody could ask for again. */}
                <Link href={`/u/${user.username}?tour=1`}>{t.welcome.reopen}</Link>
              </>
            )}
          </p>
          <form action={setLocale} className="lang-toggle">
            <button
              type="submit"
              name="locale"
              value={locale === "fr" ? "en" : "fr"}
              title={locale === "fr" ? "Switch to English" : "Passer en français"}
            >
              {locale === "fr" ? "🇬🇧 EN" : "🇫🇷 FR"}
            </button>
          </form>
        </footer>
      </body>
    </html>
  );
}
