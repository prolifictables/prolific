import type { Config } from 'tailwindcss';

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
        surface: {
          50: '#101118',
          100: '#18191F',
          200: '#1F2029',
          300: '#2A2B36',
          400: '#3A3C4A',
          500: '#565869',
        },
        ink: {
          50: '#F8FAFC',
          100: '#E2E8F0',
          200: '#CBD5E1',
          300: '#94A3B8',
          400: '#64748B',
          500: '#475569',
          600: '#334155',
        },
        neon: {
          gold: '#D4AF37',
          pure: '#FFD700',
          copper: '#CD7F32',
          amber: '#F59E0B',
          rose: '#FB7185',
          cyan: '#22D3EE',
          emerald: '#10B981',
        },
        restaurant: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        emerald: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
          800: '#065F46',
          900: '#064E3B',
        },
        amber: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        accent: {
          50: '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C',
          700: '#C2410C',
          800: '#9A3412',
          900: '#7C2D12',
        },
        slate: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: '0 4px 20px -8px rgba(212, 175, 55, 0.22)',
        card: '0 2px 12px -4px rgba(0, 0, 0, 0.35)',
        glow: '0 0 32px -8px rgba(212, 175, 55, 0.55)',
        'glow-restaurant': '0 0 30px -6px rgba(212, 175, 55, 0.38)',
        'glow-accent': '0 0 30px -6px rgba(234, 88, 12, 0.42)',
        'glow-fuchsia': '0 0 28px -6px rgba(205, 127, 50, 0.48)',
        'glow-emerald': '0 0 26px -8px rgba(16, 185, 129, 0.55)',
        ring: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
      },
      backgroundImage: {
        'gradient-neon':
          'linear-gradient(120deg, #FFD700 0%, #D4AF37 38%, #CD7F32 72%, #F59E0B 100%)',
        'gradient-sunset':
          'linear-gradient(135deg, #EA580C 0%, #CD7F32 45%, #D4AF37 100%)',
        'gradient-mesh-hero':
          'radial-gradient(circle at 15% 20%, rgba(212,175,55,0.25) 0%, transparent 45%), radial-gradient(circle at 85% 80%, rgba(245,158,11,0.22) 0%, transparent 50%)',
        'gradient-mesh-warm':
          'radial-gradient(circle at 20% 30%, rgba(234,88,12,0.20) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(205,127,50,0.25) 0%, transparent 45%)',
        'gradient-card':
          'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 45%, rgba(0,0,0,0.12) 100%)',
      },
      minHeight: {
        '14': '3.5rem',
        '16': '4rem',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '2.5rem': '2.5rem',
      },
      keyframes: {
        'neon-pulse': {
          '0%, 100%': {
            boxShadow:
              '0 0 20px -4px rgba(212, 175, 55, 0.55), 0 0 32px -10px rgba(255, 215, 0, 0.35)',
          },
          '50%': {
            boxShadow:
              '0 0 30px -2px rgba(255, 215, 0, 0.65), 0 0 48px -12px rgba(212, 175, 55, 0.45)',
          },
        },
        'neon-border': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        orbit: {
          '0%': { transform: 'rotate(0deg) translateX(40px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(40px) rotate(-360deg)' },
        },
        'grid-scroll': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '40px 40px' },
        },
        'text-glow': {
          '0%, 100%': {
            textShadow: '0 0 12px rgba(212, 175, 55, 0.55)',
          },
          '50%': {
            textShadow: '0 0 22px rgba(255, 215, 0, 0.75), 0 0 40px rgba(205, 127, 50, 0.4)',
          },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.75' },
        },
        slideUp: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'neon-pulse': 'neon-pulse 2.8s ease-in-out infinite',
        'neon-border': 'neon-border 6s ease infinite',
        'float-slow': 'float-slow 6s ease-in-out infinite',
        orbit: 'orbit 12s linear infinite',
        'grid-scroll': 'grid-scroll 20s linear infinite',
        'text-glow': 'text-glow 3.2s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'slide-up': 'slideUp 180ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
