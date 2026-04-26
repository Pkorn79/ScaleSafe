/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand primary — emerald. In-app engagement CTAs (Save, Mark Complete, Send Offer).
        'ss-primary': {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        // Funnel orange — top-of-funnel / first-conversion CTAs ONLY (enrollment funnel, customer checkout).
        // Do not use inside the in-app surface — that's ss-primary's job.
        'ss-funnel': {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        // Navy structural — sidebar, dark panels, H1/H2 dark text.
        'ss-navy': {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        // Teal accent — secondary, sidebar active, hero gradient pair to navy.
        'ss-teal': {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
        // Cream — page background, off-white card-behind surface.
        'ss-cream': {
          50: '#fafaf7',
          100: '#f5f5ed',
        },
        // Semantic risk levels — used by Defense Readiness Score and other dynamic-color widgets.
        // Do not change without updating those callers.
        'ss-safe': '#10b981',
        'ss-moderate': '#f59e0b',
        'ss-elevated': '#f97316',
        'ss-high': '#ef4444',
        'ss-critical': '#7f1d1d',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
