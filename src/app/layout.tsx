import type { Metadata } from "next";
import { Geist, Fraunces } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { logout } from "./actions";
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
  const user = await currentUser();

  return (
    <html
      lang="en"
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
              <ThemeToggle />
              <Link href="/climbers">Climbers</Link>
              {user ? (
                <>
                  <Link href="/entries/new">New entry</Link>
                  <Link href={`/u/${user.username}`}>My journal</Link>
                  <form action={logout}>
                    <button type="submit">Log out</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login">Log in</Link>
                  <Link href="/signup">Sign up</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="site-footer">
          Cragdiary — a shared climbing journal. Free, no tracking, just days on rock.
        </footer>
      </body>
    </html>
  );
}
