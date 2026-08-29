import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        kds: {
          bg: '#0B1220',
          card: '#111B2E',
          cardHover: '#17223A',
          border: '#1E2B47',
          textPrimary: '#F8FAFC',
          textMuted: '#94A3B8',
          accent: '#6366F1',
          accentHover: '#4F46E5',
          new: '#EF4444',
          preparing: '#F59E0B',
          ready: '#10B981',
          completed: '#3B82F6',
          danger: '#DC2626',
        },
      },
      boxShadow: {
        kds: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -2px rgba(0, 0, 0, 0.2)',
        'kds-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.3)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};

export default config;
