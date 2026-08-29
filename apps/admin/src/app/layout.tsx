import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ClientApiWakeLayer } from '../components/ClientApiWakeLayer';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Prolific Admin',
  description: 'Restaurant management dashboard for Prolific',
  viewport: 'width=device-width, initial-scale=1',
  themeColor: '#4F46E5',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased text-slate-800 bg-slate-50 scrollbar-thin">
        {/* Silent until any first-call detects Render waking-page 502/503, then shows
            polite custom spinner overlay — NEVER Render's "Application Loading" HTML */}
        <ClientApiWakeLayer appName="Prolific Admin" />
        {children}
      </body>
    </html>
  );
}
