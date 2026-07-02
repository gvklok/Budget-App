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
        good: {
          DEFAULT: '#1f8a4c',
          soft: '#e7f4ec',
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
