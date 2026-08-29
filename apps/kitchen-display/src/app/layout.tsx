import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ClientApiWakeLayer } from '../components/ClientApiWakeLayer';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Prolific KDS — Kitchen Display System',
  description: 'Real-time kitchen order management system with NEW, PREPARING, READY, and COMPLETED kanban columns.',
  viewport: 'width=device-width, initial-scale=1',
  themeColor: '#0B1220',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.className}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-screen bg-kds-bg text-kds-textPrimary">
        {/* Silent null by default — shows custom spinner overlay only on Render cold start.
            Never exposes Render's "Application Loading" HTML to kitchen staff. */}
        <ClientApiWakeLayer appName="Prolific KDS" />
        {children}
      </body>
    </html>
  );
}
