import type { Metadata } from "next";
import { Geist, Fraunces } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { isOwner } from "@/lib/auth";
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
  description: "A personal, free-form climbing journal.",
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
  const owner = await isOwner();

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
              {owner ? (
                <>
                  <Link href="/entries/new">New entry</Link>
                  <form action={logout}>
                    <button type="submit">Log out</button>
                  </form>
                </>
              ) : (
                <Link href="/login">Log in</Link>
              )}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="site-footer">
          Cragdiary — a personal climbing journal.
        </footer>
      </body>
    </html>
  );
}
