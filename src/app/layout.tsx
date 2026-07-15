import type { Metadata } from "next";
import { Geist, Fraunces } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import { logout, setLocale } from "./actions";
import ThemeToggle from "@/components/ThemeToggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cragdiary",
  description: "A free, Notion-style journal for climbing days.",
};

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('cragdiary-theme');
    document.documentElement.setAttribute('data-theme', t === 'minimal' ? 'minimal' : 'scrapbook');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'scrapbook');
  }
})();
`;

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
              <ThemeToggle labels={t.themes} />
              <form action={setLocale} className="lang-toggle theme-toggle">
                <button type="submit" name="locale" value="fr" data-active={locale === "fr"}>
                  FR
                </button>
                <button type="submit" name="locale" value="en" data-active={locale === "en"}>
                  EN
                </button>
              </form>
              <Link href="/climbers">{t.nav.climbers}</Link>
              {user ? (
                <>
                  <Link href="/entries/new">{t.nav.newEntry}</Link>
                  <Link href={`/u/${user.username}`}>{t.nav.myJournal}</Link>
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
        <footer className="site-footer">{t.footer}</footer>
      </body>
    </html>
  );
}
