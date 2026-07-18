import type { Metadata } from "next";
import { Geist, Fraunces } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
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
  metadataBase: new URL(process.env.APP_URL ?? "https://cragdiary.nanocorp.app"),
  title: "Cragdiary",
  description: "A free, Notion-style journal for climbing days.",
  openGraph: {
    siteName: "Cragdiary",
    type: "website",
  },
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
              <Link href="/climbers">{t.nav.climbers}</Link>
              {user ? (
                <>
                  <Link href="/entries/new">{t.nav.newEntry}</Link>
                  <Link href={`/u/${user.username}`}>{t.nav.myJournal}</Link>
                  <Link href={`/u/${user.username}#wishlist`}>{t.nav.myWishlist}</Link>
                  <form action={logout}>
                    <button type="submit">{t.nav.logout}</button>
                  </form>
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
          {t.footer} · <Link href="/credits">{t.credits.linkLabel}</Link> ·{" "}
          <Link href="/privacy">{t.privacy.linkLabel}</Link> ·{" "}
          <Link href="/feedback">{t.feedback.linkLabel}</Link>
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
