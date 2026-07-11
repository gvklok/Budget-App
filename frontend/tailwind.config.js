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
        // "kept/saved."
        saving: {
          DEFAULT: '#0f5c52',
          soft: '#e4efea',
        },
        good: {
          DEFAULT: '#0f5c52',
          soft: '#e4efea',
        },
        bills: {
          DEFAULT: '#3e6c8c',
          soft: '#e6edf1',
        },
        funds: {
          DEFAULT: '#c1652f',
          soft: '#f6e8de',
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
