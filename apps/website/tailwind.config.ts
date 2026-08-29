import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Luxury gold base palette (was violet/purple restaurant)
        restaurant: {
          50: '#FEF3C7',
          100: '#FDE68A',
          200: '#FCD34D',
          300: '#FBBF24',
          400: '#F59E0B',
          500: '#D97706',
          600: '#B45309',
          700: '#92400E',
          800: '#78350F',
          900: '#451A03',
        },
        // Sapphire / deep teal accent (kept as secondary cool contrast)
        emerald: {
          50: '#ECFEFF',
          100: '#CFFAFE',
          200: '#67E8F9',
          300: '#22D3EE',
          400: '#06B6D4',
          500: '#0891B2',
          600: '#0E7490',
          700: '#155E75',
          800: '#164E63',
          900: '#083344',
        },
        // Warm burnt-orange accent (was rose/pink)
        accent: {
          50: '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#EA580C',
          600: '#DC2626',
          700: '#B91C1C',
          800: '#991B1B',
          900: '#7F1D1D',
        },
        // Deep dark surface/ink palette (black futuristic)
        surface: {
          DEFAULT: '#09090B',
          muted: '#0F1013',
          elevated: '#131418',
          sunken: '#050506',
          panel: '#18191F',
        },
        ink: {
          DEFAULT: '#E5E7EB',
          soft: '#B6B8BF',
          muted: '#7A7C85',
          faint: '#55575F',
        },
        // Luxury gold accent palette (violet/purple/fuchsia → gold/copper)
        neon: {
          cyan: '#22D3EE',
          gold: '#D4AF37',         // metallic gold core (was violet #8B5CF6)
          rose: '#EC4899',         // warm pink contrast
          lime: '#A3E635',
          copper: '#CD7F32',       // bronze / rich copper (was fuchsia #D946EF)
          amber: '#FFD700',        // pure 24k gold highlight
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Georgia', 'Cambria', 'serif'],
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        soft: '0 4px 20px -8px rgba(212, 175, 55, 0.35)',
        card: '0 2px 12px -4px rgba(0,0,0,0.5)',
        'sm': '0 1px 2px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.6)',
        'md': '0 4px 6px -1px rgba(0,0,0,0.6), 0 2px 4px -2px rgba(0,0,0,0.6)',
        'lg': '0 10px 15px -3px rgba(0,0,0,0.7), 0 4px 6px -4px rgba(0,0,0,0.7)',
        'xl': '0 20px 25px -5px rgba(0,0,0,0.75), 0 8px 10px -6px rgba(0,0,0,0.75)',
        '2xl': '0 25px 60px -12px rgba(0,0,0,0.85)',
        // Luxury gold glow shadows (violet/fuchsia → gold/copper)
        'glow-restaurant': '0 0 30px -5px rgba(212, 175, 55, 0.60), 0 0 80px -20px rgba(212, 175, 55, 0.38)',
        'glow-accent': '0 0 30px -5px rgba(234, 88, 12, 0.58), 0 0 80px -20px rgba(234, 88, 12, 0.36)',
        'glow-emerald': '0 0 30px -5px rgba(34, 211, 238, 0.55), 0 0 80px -20px rgba(34, 211, 238, 0.35)',
        'glow-lime': '0 0 30px -5px rgba(163, 230, 53, 0.55), 0 0 80px -20px rgba(163, 230, 53, 0.35)',
        'glow-fuchsia': '0 0 30px -5px rgba(205, 127, 50, 0.60), 0 0 80px -20px rgba(205, 127, 50, 0.38)',
        // Inner inset shadow for sunken / input fields
        'inner-soft': 'inset 0 1px 2px rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        // Luxury gold gradients (violet/pink → gold/copper/amber)
        'gradient-warm': 'linear-gradient(135deg, #FBBF24 0%, #B45309 40%, #78350F 100%)',
        'gradient-sunset': 'linear-gradient(135deg, #EA580C 0%, #F59E0B 50%, #B8860B 100%)',
        'gradient-forest': 'linear-gradient(135deg, #22D3EE 0%, #0EA5E9 100%)',
        'gradient-cream': 'linear-gradient(180deg, #09090B 0%, #0F1013 100%)',
        'gradient-card': 'linear-gradient(180deg, rgba(24, 25, 31, 0.96) 0%, rgba(15, 16, 19, 0.96) 100%)',
        'gradient-mesh-warm':
          'radial-gradient(ellipse 80% 50% at 20% 0%, rgba(212, 175, 55, 0.28) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(234, 88, 12, 0.22) 0%, transparent 60%), #09090B',
        'gradient-mesh-hero':
          'radial-gradient(1200px 600px at 20% 0%, rgba(212, 175, 55, 0.36), transparent 60%), radial-gradient(800px 400px at 100% 100%, rgba(255, 215, 0, 0.22), transparent 60%)',
        'gradient-neon':
          'linear-gradient(120deg, #FFD700 0%, #D4AF37 38%, #CD7F32 72%, #F59E0B 100%)',
        'gradient-neon-soft':
          'linear-gradient(120deg, rgba(255,215,0,0.18) 0%, rgba(212,175,55,0.18) 50%, rgba(205,127,50,0.16) 100%)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-down': {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'bounce-soft': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'wiggle': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-3deg)' },
          '75%': { transform: 'rotate(3deg)' },
        },
        'progress': {
          '0%': { width: '0%' },
          '100%': { width: '100%' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pop': {
          '0%': { transform: 'scale(1)' },
          '30%': { transform: 'scale(0.92)' },
          '60%': { transform: 'scale(1.06)' },
          '100%': { transform: 'scale(1)' },
        },
        'ripple': {
          '0%': { transform: 'scale(0)', opacity: '0.35' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        },
        // Luxury gold / futuristic new
        'neon-pulse': {
          '0%, 100%': { boxShadow: '0 0 8px -2px rgba(212,175,55,0.65), 0 0 24px -6px rgba(212,175,55,0.48)' },
          '50%': { boxShadow: '0 0 18px -2px rgba(255,215,0,0.88), 0 0 48px -6px rgba(212,175,55,0.65)' },
        },
        'neon-border': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translate3d(0,0,0) rotate(0deg)' },
          '33%': { transform: 'translate3d(6px,-14px,0) rotate(2deg)' },
          '66%': { transform: 'translate3d(-8px,-6px,0) rotate(-1.5deg)' },
        },
        'orbit': {
          '0%': { transform: 'rotate(0deg) translateX(30px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(30px) rotate(-360deg)' },
        },
        'grid-scroll': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '40px 40px' },
        },
        'text-glow': {
          '0%, 100%': { textShadow: '0 0 10px rgba(212,175,55,0.52), 0 0 30px rgba(212,175,55,0.26)' },
          '50%': { textShadow: '0 0 20px rgba(255,215,0,0.60), 0 0 48px rgba(205,127,50,0.32)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out both',
        'fade-in-up': 'fade-in-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in-down': 'fade-in-down 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-down': 'slide-down 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-right': 'slide-in-right 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'shimmer': 'shimmer 1.6s linear infinite',
        'pulse-soft': 'pulse-soft 2.2s ease-in-out infinite',
        'bounce-soft': 'bounce-soft 2s ease-in-out infinite',
        'wiggle': 'wiggle 0.6s ease-in-out',
        'progress': 'progress 1.5s ease-out both',
        'float': 'float 5s ease-in-out infinite',
        'pop': 'pop 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        'ripple': 'ripple 0.6s ease-out',
        // Neon / cyber animations
        'neon-pulse': 'neon-pulse 2.6s ease-in-out infinite',
        'neon-border': 'neon-border 6s ease infinite',
        'float-slow': 'float-slow 9s ease-in-out infinite',
        'orbit': 'orbit 12s linear infinite',
        'grid-scroll': 'grid-scroll 12s linear infinite',
        'text-glow': 'text-glow 4s ease-in-out infinite',
        // Delayed stagger variants
        'fade-in-up-100': 'fade-in-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) 100ms both',
        'fade-in-up-200': 'fade-in-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) 200ms both',
        'fade-in-up-300': 'fade-in-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) 300ms both',
        'fade-in-up-400': 'fade-in-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) 400ms both',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'in-out-quart': 'cubic-bezier(0.76, 0, 0.24, 1)',
      },
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
        '800': '800ms',
      },
      container: {
        center: true,
        padding: {
          DEFAULT: '1rem',
          sm: '1.5rem',
          lg: '2rem',
        },
        screens: {
          '2xl': '1280px',
        },
      },
      fontSize: {
        'display': ['clamp(2rem, 5vw + 0.5rem, 3.75rem)', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        'display-sm': ['clamp(1.6rem, 3.5vw + 0.3rem, 2.6rem)', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'caption': ['0.6875rem', { lineHeight: '1.5', letterSpacing: '0.08em', fontWeight: '500' }],
      },
      letterSpacing: {
        'tightest': '-0.035em',
      },
    },
  },
  plugins: [],
};

export default config;
