import type { Metadata } from 'next';
import { DM_Sans, Fraunces } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '600', '700'],
});

const sans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'VERN — Office of the CFO',
  description: 'Audit-ready AP close agent for Track 2',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${display.variable} ${sans.variable}`}
      suppressHydrationWarning
    >
      <body
        style={{ fontFamily: 'var(--font-sans), system-ui, sans-serif' }}
        suppressHydrationWarning
      >
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              VERN
            </Link>
            <nav className="nav" aria-label="Primary">
              <Link href="/">Dashboard</Link>
              <Link href="/exceptions">Exceptions</Link>
              <Link href="/close">Close</Link>
              <Link href="/traces">Traces</Link>
              <Link href="/audit">Audit</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
