/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      // Shared visual language, locked in during the delve-ui-reference mockup
      // review (see docs/ROADMAP.md, "Design decisions confirmed"). Tailwind's
      // default spacing scale is already a 4px grid (spacing-1 = 4px, -2 = 8px,
      // ...) so no spacing tokens are added here -- just stick to that scale
      // instead of arbitrary px values.
      //
      // Semantic colors are reserved for ONE meaning each, everywhere in the
      // app -- do not reach for e.g. `primary` just because something is
      // "selected" if it isn't actually the primary action:
      //   primary  - primary actions / active tab or step ONLY
      //   positive - alive / complete / saved / success ONLY
      //   warning  - urgent / low resource / clock or danger-adjacent ONLY
      //   danger   - dying / critical / destructive ONLY
      //   ai       - AI-GM identity / GM-only / private ONLY
      colors: {
        bg: '#0a0a0a',
        panel: '#131313',
        panel2: '#1a1a1a',
        line: '#242424',
        'line-soft': '#1a1a1a',
        ink: {
          DEFAULT: '#f2f2f2',
          dim: '#9a9a9a',
          faint: '#636363',
        },
        primary: {
          DEFAULT: '#3b82f6',
          text: '#93c5fd',
          bg: 'rgb(59 130 246 / 0.10)',
          line: 'rgb(59 130 246 / 0.40)',
        },
        positive: {
          DEFAULT: '#22c55e',
          text: '#86efac',
          bg: 'rgb(34 197 94 / 0.10)',
          line: 'rgb(34 197 94 / 0.40)',
        },
        warning: {
          DEFAULT: '#f5a524',
          text: '#fcd34d',
          bg: 'rgb(245 165 36 / 0.10)',
          line: 'rgb(245 165 36 / 0.40)',
        },
        danger: {
          DEFAULT: '#ef4444',
          text: '#fca5a5',
          bg: 'rgb(239 68 68 / 0.10)',
          line: 'rgb(239 68 68 / 0.40)',
        },
        ai: {
          DEFAULT: '#a855f7',
          text: '#d8b4fe',
          bg: 'rgb(168 85 247 / 0.10)',
          line: 'rgb(168 85 247 / 0.40)',
        },
      },
    },
  },
  plugins: [],
}
