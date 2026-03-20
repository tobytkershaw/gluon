// src/ui/design-tokens.ts
// Formalized design tokens for the Gluon UI.
// Extracted from mockups/shared.css and mockups/07-design-tokens.html.
// Additive only — existing components continue using inline Tailwind classes.

// ── Colors: Neutral Palette (Warm Zinc) ──────────────────────────────────────

export const zinc = {
  50: '#faf9f7',
  100: '#f3f1ed',
  200: '#e5e2dc',
  300: '#d1cdc5',
  400: '#a8a39a',
  500: '#7c776e',
  600: '#57534e',
  700: '#3d3935',
  800: '#282523',
  900: '#1c1917',
  950: '#0f0e0c',
} as const;

// ── Colors: Accent ───────────────────────────────────────────────────────────

export const accent = {
  /** Instruments, active state, agency */
  amber: '#fbbf24',
  amberDeep: '#f59e0b',
  /** AI/chat, modulation */
  violet: '#a78bfa',
  violetMid: '#8b5cf6',
  violetDeep: '#7c3aed',
  /** Processors, sky elements */
  sky: '#38bdf8',
  /** Freeze, loop markers */
  cyan: '#22d3ee',
  /** Success, generative, patterns */
  emerald: '#34d399',
  /** Recording, danger, gates */
  rose: '#fb7185',
  /** Connected status */
  teal: '#2dd4bf',
} as const;

// ── Colors: Surface Roles ────────────────────────────────────────────────────

export const surface = {
  /** Full-screen background */
  bgDeep: zinc[950],
  /** Primary containers: topbar, footer, panels */
  bgSurface: zinc[900],
  /** Interactive elements: buttons, inputs, cards */
  bgRaised: zinc[800],
  /** Hover state for interactive elements */
  bgHover: zinc[700],
  /** Standard border */
  border: 'rgba(61, 57, 53, 0.6)',
  /** Subtle border for separators */
  borderSubtle: 'rgba(61, 57, 53, 0.3)',
} as const;

// ── Colors: Text Roles ───────────────────────────────────────────────────────

export const text = {
  /** Main body text */
  primary: zinc[200],
  /** Secondary labels, tool names */
  secondary: zinc[400],
  /** Disabled, tertiary, placeholders */
  muted: zinc[500],
  /** Very faint, barely visible */
  faint: zinc[600],
} as const;

// ── Colors: AI Space ─────────────────────────────────────────────────────────

export const aiSpace = {
  /** AI space background (deep purple) */
  bg: '#13111C',
  /** AI border (violet tint) */
  border: 'rgba(139, 92, 246, 0.35)',
  /** AI glow (subtle violet ambient) */
  glow: 'rgba(139, 92, 246, 0.08)',
  /** AI accent color */
  accent: accent.violet,
  /** AI composer pill border */
  pillBorder: 'rgba(139, 92, 246, 0.15)',
  /** AI composer pill inset highlight */
  pillInset: 'rgba(139, 92, 246, 0.1)',
} as const;

// ── Colors: Tool Type ────────────────────────────────────────────────────────

export const toolTypeColor = {
  source: accent.amber,
  processor: accent.sky,
  pattern: accent.emerald,
  param: zinc[500],
  surface: accent.violet,
  transport: zinc[400],
} as const;

// ── Colors: Status ───────────────────────────────────────────────────────────

export const statusColor = {
  connected: accent.teal,
  warning: accent.amber,
  error: accent.rose,
  success: accent.emerald,
} as const;

// ── Colors: Port Signal Types (Patch view) ───────────────────────────────────

export const portColor = {
  audio: accent.amber,
  cv: accent.emerald,
  gate: accent.rose,
} as const;

// ── Colors: Module Accents (Rack view) ───────────────────────────────────────

export const moduleAccent = {
  source: accent.amber,
  processor: accent.sky,
  modulator: accent.violet,
} as const;

// ── Spacing (4px base grid) ──────────────────────────────────────────────────

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

// ── Border Radii ─────────────────────────────────────────────────────────────

export const radius = {
  /** Step cells, micro elements */
  xs: 2,
  /** View tabs, small buttons */
  sm: 4,
  /** Tool blocks, track items */
  md: 6,
  /** Panels, modules, action cards */
  lg: 8,
  /** Composer input, large containers */
  xl: 12,
  /** Dots, knobs, circular buttons */
  full: '50%',
} as const;

// ── Shadows ──────────────────────────────────────────────────────────────────

export const shadow = {
  /** Floating buttons */
  float: '0 2px 12px rgba(0, 0, 0, 0.3)',
  /** Modals, popups */
  overlay: '0 4px 24px rgba(0, 0, 0, 0.4)',
  /** AI compositor pill */
  ai: '0 4px 24px rgba(0, 0, 0, 0.4), 0 0 16px rgba(139, 92, 246, 0.08), inset 0 1px 0 rgba(139, 92, 246, 0.1)',
  /** AI membrane edge glow */
  aiGlow: '-6px 0 20px rgba(139, 92, 246, 0.08), inset 3px 0 12px rgba(139, 92, 246, 0.06)',
} as const;

// ── Component Sizing ─────────────────────────────────────────────────────────

export const sizing = {
  layout: {
    topbarHeight: 40,
    footerHeight: 24,
    sidebarWidth: 48,
    sidebarExpandedWidth: 180,
    chatMaxWidth: 720,
    liveControlsWidth: 340,
  },
  transport: {
    buttonSize: 24,
    iconSize: 10,
    dividerWidth: 1,
    dividerHeight: 16,
    peakMeterBarWidth: 3,
    peakMeterBarHeight: 18,
  },
  rack: {
    moduleHeight: 572,
    knobLg: 52,
    knobMd: 42,
    knobSm: 32,
  },
  surfaceGrid: {
    columns: 12,
    rowHeight: 60,
    margin: 8,
  },
  patch: {
    nodeWidth: 180,
    nodeHeaderHeight: 40,
    portRowHeight: 22,
    portRadius: 5,
    nodeGap: 80,
  },
  presence: {
    dotSize: 6,
    agencyDotSize: 6,
    toolTypeBarWidth: 3,
    toolTypeBarHeight: 14,
    trackAccentWidth: 3,
    trackAccentHeight: 24,
  },
} as const;

// ── Z-Index Scale ────────────────────────────────────────────────────────────

export const zIndex = {
  /** Floating panels, live controls */
  overlay: 100,
  /** Modal dialogs */
  modal: 200,
  /** The Coin (Cmd+K toggle) */
  coin: 300,
  /** Tooltips, popovers */
  tooltip: 400,
} as const;

// ── Transition Durations ─────────────────────────────────────────────────────

export const transition = {
  /** Hovers, toggles — 150ms ease */
  fast: '150ms ease',
  /** Panel opens, fades — 250ms ease */
  normal: '250ms ease',
  /** Mode transitions — 400ms cubic-bezier */
  slow: '400ms cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

export const transitionMs = {
  fast: 150,
  normal: 250,
  slow: 400,
} as const;

// ── Typography ───────────────────────────────────────────────────────────────

export const font = {
  sans: "'Syne', system-ui, sans-serif",
  mono: "'DM Mono', ui-monospace, monospace",
} as const;

export const typeScale = {
  '2xs': 8,
  xs: 9,
  sm: 10,
  md: 11,
  base: 12,
  lg: 14,
  xl: 15,
  '2xl': 16,
  '3xl': 18,
} as const;

// ── Animation names (defined in index.css) ───────────────────────────────────
// These constants reference the @keyframes names defined in CSS.
// Use them in inline styles or className-based animation assignments.

export const animation = {
  /** Slow opacity oscillation for AI presence dots (3s cycle) */
  breathing: 'breathing 3s ease-in-out infinite',
  /** Gentle scale pulse for active indicators */
  pulseSoft: 'pulse-soft 2s ease-in-out infinite',
  /** Emerald glow pulse for Coin working state */
  coinPulseEmerald: 'coin-pulse-emerald 2s ease-in-out infinite',
  /** Amber glow pulse for Coin attention state */
  coinPulseAmber: 'coin-pulse-amber 2s ease-in-out infinite',
  /** Fade in for card transitions */
  fadeIn: 'fade-in 250ms ease forwards',
  /** Fade out for card transitions */
  fadeOut: 'fade-out 250ms ease forwards',
  /** AI background breathing */
  aiBreathe: 'ai-breathe 3s ease-in-out infinite',
} as const;
