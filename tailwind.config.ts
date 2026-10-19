import type { Config } from 'tailwindcss';

// Tokens: warm umber surfaces (a desk at night), paper-toned ink, one brass
// accent for focus and action. Chart hues are validated separately (see
// lib/chart-theme.ts) against the ink-900 surface.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#15120f',
          900: '#1d1915',
          850: '#231e19',
          800: '#2c261f',
          700: '#3b332b',
          600: '#574c41',
        },
        paper: {
          50: '#efe6d6',
          100: '#e3d8c5',
          300: '#c4b49b',
          500: '#93846f',
        },
        ember: {
          300: '#ecc77d',
          400: '#e0aa4a',
          500: '#bf8a30',
        },
        dusk: { 300: '#a9bde9', 400: '#6f93d9' },
        sage: { 300: '#a8c8a4', 400: '#7fae84' },
        rose: { 300: '#f2ad93', 400: '#e0805c' },
      },
      fontFamily: {
        serif: ['"Literata Variable"', 'Iowan Old Style', 'Palatino Linotype', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
