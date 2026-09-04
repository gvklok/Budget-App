// Curated preset pool for the app's 3 semantic bucket colors (Bills, Funds,
// Savings — see theme.js's "Semantic money-concept colors" block). Each
// preset carries its own hand-tuned `{base, ink, soft}` triple for BOTH light
// and dark mode, mirroring the structure index.css already hand-tunes for
// the 3 shipped defaults (umber/sage/ocean below — their RGB values are
// copied verbatim from index.css, so picking "Default" is a no-op vs. never
// touching Settings at all).
//
// Values are bare "R G B" channel triplets — same convention as index.css
// (see that file's top comment) so they can be written straight into a CSS
// custom property with `style.setProperty('--bills', '125 81 25')`.
//
// The 6 new hues (terracotta/olive/teal/slate/violet/berry) were derived
// with the dataviz skill's method: each targets the categorical band/chroma
// checks in both modes, and the full 9-preset pool (light and dark, all
// pairs — every preset can end up adjacent to any other since the user
// picks freely per bucket) was run through `validate_palette.js`. Lightness
// band, chroma floor (except the pre-existing umber default, which already
// shipped at C 0.091/0.099 — not something this task changed), and contrast
// all PASS; worst-case CVD separation lands at ΔE ~10.2 (the 8–12 "floor"
// band) — legal because every real use of these colors pairs the swatch
// with a visible text label (bucket name, chip, legend), never bare color
// alone, satisfying the mandatory secondary-encoding relief.
export const BUCKET_COLOR_PRESETS = [
  {
    key: 'umber',
    name: 'Umber',
    isDefaultFor: 'bills',
    light: { base: '125 81 25', ink: '138 86 24', soft: '241 232 220' },
    dark: { base: '168 118 58', ink: '224 181 127', soft: '51 38 25' },
  },
  {
    key: 'terracotta',
    name: 'Terracotta',
    light: { base: '155 53 68', ink: '128 27 47', soft: '255 228 229' },
    dark: { base: '181 78 90', ink: '253 149 158', soft: '56 21 25' },
  },
  {
    key: 'olive',
    name: 'Olive',
    light: { base: '110 114 0', ink: '73 76 0', soft: '235 238 215' },
    dark: { base: '137 141 9', ink: '185 191 91', soft: '34 36 0' },
  },
  {
    key: 'sage',
    name: 'Sage',
    isDefaultFor: 'savings',
    light: { base: '47 138 92', ink: '40 107 73', soft: '231 243 237' },
    dark: { base: '69 168 115', ink: '126 203 158', soft: '28 51 39' },
  },
  {
    key: 'teal',
    name: 'Teal',
    light: { base: '0 136 113', ink: '0 85 69', soft: '216 242 234' },
    dark: { base: '0 136 113', ink: '74 209 179', soft: '0 41 32' },
  },
  {
    key: 'slate',
    name: 'Slate',
    light: { base: '0 151 168', ink: '0 82 91', soft: '213 241 246' },
    dark: { base: '0 158 175', ink: '48 205 225', soft: '0 39 44' },
  },
  {
    key: 'ocean',
    name: 'Ocean',
    isDefaultFor: 'funds',
    light: { base: '47 95 158', ink: '47 95 158', soft: '230 237 246' },
    dark: { base: '74 127 201', ink: '111 159 224', soft: '24 38 54' },
  },
  {
    key: 'violet',
    name: 'Violet',
    light: { base: '156 106 191', ink: '94 44 125', soft: '241 230 251' },
    dark: { base: '138 88 172', ink: '208 160 243', soft: '42 25 53' },
  },
  {
    key: 'berry',
    name: 'Berry',
    light: { base: '155 68 126', ink: '117 32 92', soft: '250 228 241' },
    dark: { base: '188 98 157', ink: '238 150 206', soft: '51 22 41' },
  },
]

// The 3 buckets exposed in Settings, and the CSS custom property triad each
// one drives. (Transfer-out keeps its fixed neutral stone — it's a state,
// "money moved but not spent," not a bucket the owner asked to re-theme.)
export const BUCKET_VARS = {
  bills: ['--bills', '--bills-ink', '--bills-soft'],
  funds: ['--funds', '--funds-ink', '--funds-soft'],
  savings: ['--saving', '--saving-ink', '--saving-soft'],
}

export const DEFAULT_BUCKET_PRESET = {
  bills: 'umber',
  funds: 'ocean',
  savings: 'sage',
}

export function presetByKey(key) {
  return BUCKET_COLOR_PRESETS.find((p) => p.key === key)
}
