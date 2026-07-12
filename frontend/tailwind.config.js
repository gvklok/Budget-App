/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#17140f',
          2: '#5c574a',
          3: '#9c9484',
        },
        paper: '#f6f4ef',
        card: '#ffffff',
        line: {
          DEFAULT: '#eae5d9',
          strong: '#ddd5c4',
        },
        accent: {
          DEFAULT: '#0f5c52',
          soft: '#e4efea',
          hover: '#0c4a42',
        },
        // Semantic money-concept colors (see theme.js for the full rationale)
        // — one hue per concept, app-wide. `good` is a deliberate alias of
        // `saving`: the app has exactly one green and it always means
        // "kept/saved." `saving` is deliberately lighter/friendlier than
        // `accent` — decoupled on purpose so Savings never reads as "another
        // button." `ink` is the darker text-safe step for small text on the
        // `soft` background (>=4.5:1) — use it wherever saving/good renders
        // as small TEXT (chips, amounts), reserve DEFAULT for fills/marks.
        saving: {
          DEFAULT: '#2f8a5c',
          soft: '#e7f3ed',
          ink: '#286b49',
        },
        good: {
          DEFAULT: '#2f8a5c',
          soft: '#e7f3ed',
          ink: '#286b49',
        },
        // Bills: earthy clay/umber (obligation, sober). `ink` is the darker
        // text-safe step for small text on the `soft` chip background — the
        // DEFAULT hue only clears ~4:1 there, short of 4.5:1 for small text.
        bills: {
          DEFAULT: '#9c6522',
          soft: '#f1e8dc',
          ink: '#8a5618',
        },
        // Funds: dusty-confident blue (fun money). DEFAULT clears 4.5:1+ on
        // white/paper/soft already, so no separate `ink` step is needed.
        funds: {
          DEFAULT: '#2f5f9e',
          soft: '#e6edf6',
        },
        transfer: {
          DEFAULT: '#9c9484',
          soft: '#efece4',
        },
        warn: {
          DEFAULT: '#a8791f',
          soft: '#fbf1de',
        },
        critical: {
          DEFAULT: '#b23b2e',
          soft: '#f8e7e4',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(23, 20, 15, 0.04), 0 8px 24px -12px rgba(23, 20, 15, 0.10)',
        pop: '0 12px 32px -8px rgba(23, 20, 15, 0.20)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
