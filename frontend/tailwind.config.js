// Wraps a CSS custom property (stored as a bare "R G B" channel triplet — see
// index.css) so Tailwind's opacity modifiers work (`bg-ink/90`, `text-x/50`,
// ...). This is Tailwind's documented pattern for CSS-variable-based colors;
// without it, `/NN` utilities on a var()-based color are silently dropped at
// build time (Tailwind can't resolve a runtime var() into channels itself).
function withOpacity(variable) {
  return ({ opacityValue }) =>
    opacityValue === undefined ? `rgb(var(${variable}))` : `rgb(var(${variable}) / ${opacityValue})`
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: withOpacity('--ink'),
          2: withOpacity('--ink-2'),
          3: withOpacity('--ink-3'),
        },
        // Text/icon color for content drawn on top of an `ink`-colored
        // surface (bg-ink pills/cards/tooltips) — see index.css for the
        // rationale. Opposite polarity of `ink`, so it always stays readable.
        'on-ink': withOpacity('--on-ink'),
        paper: withOpacity('--paper'),
        card: withOpacity('--card'),
        line: {
          DEFAULT: withOpacity('--line'),
          strong: withOpacity('--line-strong'),
        },
        // Full rgba() already — not a channel triplet, so no withOpacity.
        scrim: 'var(--scrim)',
        accent: {
          DEFAULT: withOpacity('--accent'),
          soft: withOpacity('--accent-soft'),
          hover: withOpacity('--accent-hover'),
          // Text/border-safe step for standalone `text-accent`/`border-accent`
          // uses — diverges from DEFAULT in dark mode (see index.css).
          ink: withOpacity('--accent-ink'),
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
          DEFAULT: withOpacity('--saving'),
          soft: withOpacity('--saving-soft'),
          ink: withOpacity('--saving-ink'),
        },
        good: {
          DEFAULT: withOpacity('--saving'),
          soft: withOpacity('--saving-soft'),
          ink: withOpacity('--saving-ink'),
        },
        // Bills: earthy clay/umber (obligation, sober). `ink` is the darker
        // text-safe step for small text on the `soft` chip background — the
        // DEFAULT hue only clears ~4:1 there, short of 4.5:1 for small text.
        bills: {
          DEFAULT: withOpacity('--bills'),
          soft: withOpacity('--bills-soft'),
          ink: withOpacity('--bills-ink'),
        },
        // Funds: dusty-confident blue (fun money). `ink` text-safe step
        // matches DEFAULT in light mode (already clears 4.5:1+) but diverges
        // in dark mode, same pattern as saving/bills.
        funds: {
          DEFAULT: withOpacity('--funds'),
          soft: withOpacity('--funds-soft'),
          ink: withOpacity('--funds-ink'),
        },
        transfer: {
          DEFAULT: withOpacity('--transfer'),
          soft: withOpacity('--transfer-soft'),
        },
        warn: {
          DEFAULT: withOpacity('--warn'),
          soft: withOpacity('--warn-soft'),
        },
        critical: {
          DEFAULT: withOpacity('--critical'),
          soft: withOpacity('--critical-soft'),
        },
        // Fixed-order categorical chart palette — identity slots. See
        // theme.js CHART_COLORS for the ordering rationale.
        chart: {
          1: withOpacity('--chart-1'),
          2: withOpacity('--chart-2'),
          3: withOpacity('--chart-3'),
          4: withOpacity('--chart-4'),
          5: withOpacity('--chart-5'),
          6: withOpacity('--chart-6'),
          7: withOpacity('--chart-7'),
        },
        // Dev Panel — permanently dark "console" surface, independent of
        // light/dark mode (see index.css — not redefined under .dark). Plain
        // hex custom properties (no opacity modifier is ever applied to
        // these), so no withOpacity wrapper needed.
        devpanel: 'var(--devpanel)',
        devcritical: {
          DEFAULT: 'var(--devcritical)',
          hover: 'var(--devcritical-hover)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
