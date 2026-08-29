import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ClientApiWakeLayer } from '../components/ClientApiWakeLayer';

export const metadata: Metadata = {
  title: 'Prolific Tables — Order & Pay from Your Table',
  description:
    'Scan the QR code on your table to browse the menu, order, and pay without waiting. Dine-in, pickup, or delivery — from the same kitchen you love.',
  keywords: ['restaurant', 'Nigeria', 'QR ordering', 'dine-in', 'food delivery', 'menu'],
  openGraph: {
    title: 'Prolific Tables — Order & Pay from Your Table',
    description: 'Warm hospitality. Bold flavours. Order from your seat.',
    type: 'website',
    locale: 'en_NG',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#050506',
};

/**
 * Root layout — deliberately does NOT wrap children in a max-width phone frame.
 *
 * The QR-table shell (/t/[token]/…) wraps itself in `DinerLayout` (a centered
 * phone-like frame). The public marketing home page uses the full responsive
 * viewport so it looks polished on desktop / tablet / mobile.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="antialiased bg-[#050506] text-ink min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-gradient-neon focus:px-4 focus:py-2 focus:text-white focus:shadow-glow-restaurant"
        >
          Skip to content
        </a>
        {/* Mounted very early. Overlay is null by default. Only shows polite
            spinner overlay during Render cold-start (20-90s first request of day).
            Never forwards to Render "Application Loading" HTML page. */}
        <ClientApiWakeLayer appName="Prolific Tables" />
        {children}
      </body>
    </html>
  );
}

