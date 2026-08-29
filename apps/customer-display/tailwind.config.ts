import type { Config } from 'tailwindcss';

// Customer Display shares the same black/gold/neon cyber theme as the POS so
// the in-restaurant screens look like one cohesive system.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#E6ECF5',
          100: '#C7D3E8',
          200: '#95A9CF',
          300: '#627FB6',
          400: '#3D5A9A',
          500: '#223F79',
          600: '#1A3260',
          700: '#132648',
          800: '#0B1220',
          900: '#060912',
          950: '#03050A',
        },
        ink: {
          50: '#F8FAFC',
          100: '#E2E8F0',
          200: '#CBD5E1',
          300: '#94A3B8',
          400: '#64748B',
          500: '#475569',
        },
      },
      boxShadow: {
        'glow-restaurant':
          '0 0 0 1px rgba(212,175,55,0.35) inset, 0 0 32px -8px rgba(255,215,0,0.35)',
      },
      keyframes: {
        'text-glow': {
          '0%,100%': { textShadow: '0 0 0 rgba(255,215,0,0)' },
          '50%': { textShadow: '0 0 24px rgba(255,215,0,0.55)' },
        },
      },
      animation: {
        'text-glow': 'text-glow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
