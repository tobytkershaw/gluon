# UI Frame & Surface: Visual Design Specification

**Status:** Ready for implementation
**Phase:** Finalization
**Depends on:** Surface milestone complete (#1051-#1067), warm zinc palette (index.css @theme)

**Related docs:**
- `docs/briefs/visual-language.md` — Surface Score schema (palette, material, motion, atmosphere, relationships)
- `docs/rfcs/surface-north-star.md` — Surface architectural vision, module system, AI curation
- `docs/rfcs/view-architecture.md` — Four-view model (Surface, Rack, Patch, Tracker)
- `docs/rfcs/ai-curated-surfaces.md` — Semantic controls, AI surface operations
- `docs/design-references.md` — Reference hardware and software design patterns

---

## 1. The Problem

Gluon's functionality is strong — 46+ AI tools, 7 working Surface module types, full canonical views, audio snapshots, modulation routing, arrangement. The design thinking is equally strong: the Surface Score brief, the canonical/performative view split, the "soft machinery with bioelectric accents" direction, the view architecture RFC.

But the rendered UI does not reflect any of this. What the user sees is a generic dark-mode developer interface: zinc-on-zinc, static, flat, uniform. Every zone — the top bar, the footer, the track sidebar, the content area — shares the same visual weight, the same border treatments, the same typographic scale. There is no hierarchy, no sense that you are looking at an instrument.

The gap is between the design docs and the CSS. The architecture stopped at TypeScript interfaces and left "pixel-level visual design" as a deferred concern. That deferred concern is now the thing that makes Gluon feel like a prototype rather than a product.

### Specific symptoms

**No visual hierarchy.** The frame (chrome) and the canvas (content area) are the same surface (`bg-zinc-950` everywhere). Your eye doesn't know where the instrument is vs where the housing is.

**Border inconsistency.** At least 5 different border treatments exist with no system: `zinc-700/40`, `zinc-800/60`, `zinc-800/30`, `zinc-800`, `zinc-700`. Borders are the skeleton of the layout and they read as arbitrary.

**Typography sprawl.** 7+ font sizes (`text-[7px]` through `text-lg`) without clear hierarchy. No distinction between chrome labels, control values, and supporting text.

**Static Surface.** The Surface modules consume `ModuleVisualContext` but most only use `getAccentColor()` for a label or border. Weight, prominence, and edge style — properties that already ship — are barely visible. The "soft machinery" direction from the brief is absent.

**Uniform track identity.** The per-track visual identity system shipped (#1064) but tracks look the same — accent color differences are subtle, weight/edge/prominence are not perceptible. The north star says "A Surface that looks the same for every track is failing at its job."

**No motion.** Nothing moves, nothing breathes, nothing responds to the music. The chat sidebar has a violet breathing animation (the most designed part of the UI), but the instrument side is entirely static.

### What's already working

Not everything is wrong. Important foundations exist:

- **Warm zinc palette.** The `@theme` override in `index.css` shifts the zinc scale toward warm stone/brown tones. This is the "warm rather than sterile" direction already in the foundations.
- **Intentional typography.** Syne (geometric sans with character) + DM Mono. These are good choices.
- **AI space identity.** The chat sidebar has real visual design — violet breathing animation, glow border, backdrop blur. It feels like a different zone.
- **Canvas-based modules.** The XY Pad and Piano Roll use full 2D canvas rendering with radial glow, variable-alpha accents, and fine grid lines. These hint at what the vision could feel like.
- **Visual identity infrastructure.** `TrackVisualIdentity`, `ModuleVisualContext`, `deriveModuleVisualContext()`, `getModuleContainerStyle()` all exist and work. The pipeline from track state to visual properties is wired.
- **Surface Score types.** Fully designed in the brief with TypeScript interfaces for all six domains (palette, track identity, material, motion, atmosphere, relationships). Ready to implement when the rendering layer can consume them.

---

## 2. The Principle: Outside In

The Surface is an amazing canvas that lives in a rock solid frame. We build the frame first.

**The frame** is everything that is not the view content area: the top bar, the footer, the track sidebar, the view toggle, the borders and dividers, the chat sidebar. The frame is the housing of the instrument — the enclosure, the fascia, the panel.

**The canvas** is the content area where Surface, Rack, Tracker, and Patch render. The canvas is the working surface — where the musician's attention lives, where the AI's curation becomes visible, where the music takes visual form.

The frame must be good enough to contain the canvas before the canvas can shine. A beautiful Surface module rendered inside a generic zinc shell looks wrong — like a high-end synthesizer module mounted in a cardboard box. The frame establishes the quality bar that Surface rises to meet.

### Design register

The frame and the canvas serve different cognitive tasks and should feel different:

| | Frame (chrome) | Canvas (content) |
|---|---|---|
| **Feel** | Dense, precise, receding | Open, alive, foregrounded |
| **Role** | Housing, navigation, status | The instrument, the work |
| **Attention** | Peripheral — you glance at it | Central — you look into it |
| **Change rate** | Rarely changes | Changes with every action |
| **Visual weight** | Heavier, darker, more opaque | Lighter, more spacious |

This split is the architectural equivalent of the canonical/Surface view distinction. The frame is the x-ray (precise, structural, stable). The canvas is the instrument (alive, adaptive, atmospheric).

---

## 3. The Frame

### 3.1 Zone map

```
┌─────────────────────────────────────────────────────────────────────┐
│ TOP BAR (chrome)                                                    │
│ Project | View Toggle | Transport              | Undo/Redo | A/B   │
├──────────────────────────────────────────┬──────────┬───────────────┤
│                                          │          │               │
│  CANVAS (content area)                   │  TRACK   │  CHAT         │
│  Surface / Rack / Patch / Tracker        │  SIDEBAR │  SIDEBAR      │
│                                          │  (chrome)│  (AI space)   │
│                                          │          │               │
├──────────────────────────────────────────┴──────────┴───────────────┤
│ FOOTER (chrome)                                                     │
│ Audio load | Position | Mode | Track count          | Meter | Chat  │
└─────────────────────────────────────────────────────────────────────┘
```

Five zones, three visual registers:

1. **Chrome** (top bar, footer, track sidebar): Dense, dark, structural. The housing.
2. **Canvas** (content area): Open, lighter, where the view renders. The working surface.
3. **AI space** (chat sidebar): Its own identity — violet-tinted, breathing. The collaborator's zone.

### 3.2 Chrome: top bar and footer

The top bar and footer are the instrument's fascia. They should feel like the face panel of a hardware synth — dense with information, precise, slightly receding so the canvas is foregrounded.

**Top bar** (current: 36px `h-9`):
- Keep the current height. It's compact and correct for chrome — a fascia strip, not a toolbar.
- Background: slightly darker/denser than the canvas. Distinct enough to read as a separate surface, not just a border away from the same background.
- Internal dividers: consistent, subtle — a single border treatment for all vertical separators.
- Transport controls: the visual anchor of the top bar. The bar:beat display and BPM readout should be the most prominent elements — the numbers the musician glances at. Play/stop should feel like hardware buttons (they already use rounded-full with border; refine the active/inactive states for more contrast).
- View toggle: see section 3.4.
- Undo/Redo and A/B: compact, secondary. These are collaboration controls, not performance controls.

**Footer** (current: 28px `h-7`):
- Same visual register as the top bar — continuous fascia.
- Content: audio load, bar:beat position, transport mode, track count, master peak meter, chat toggle. All status information.
- Currently feels like a debug bar. The fix is not to add more — it's to give it the same material quality as the top bar so it reads as the bottom edge of the instrument, not an afterthought.

### 3.3 Chrome: track sidebar

The track sidebar (current: 192px `w-48`) is the bridge between frame and canvas. It shows what tracks exist, which is selected, and provides mixing controls. In Surface view, it switches to the Stage variant (compact cards).

**Default variant** (Rack, Tracker, Patch):
- Track rows with thumbprint dots, names, M/S/approval, level meters.
- The thumbprint dot is the one element that carries track visual identity. Currently 8px (`w-2 h-2`). Small, but correct — in the default variant, identity is secondary to function.
- Level meters (vertical per-track) provide the only real-time visual feedback in the sidebar. These should feel like they belong in the same enclosure as the top bar.

**Stage variant** (Surface view):
- Compact identity cards with color accent bar, track name, role badge, module count.
- This variant is where visual identity matters most. The accent bar (currently 2px `w-0.5`) is the primary identity signal. Consider whether weight, edge style, and prominence from `TrackVisualIdentity` should influence the Stage card more visibly — a heavy bass track's card should feel denser than a light hi-hat card.

**Master bus section** (anchored at bottom):
- Volume slider, master peak meter.
- Should feel like the master section of a mixer — visually grounded, always present.

### 3.4 View toggle

The view toggle (current: 11px mono text pills in a zinc-900 rounded container) is the navigator between five fundamentally different views. It currently reads as tabs, not as a mode selector for an instrument.

Each view has a character:
- **Chat**: Conversation. Text-primary. The AI's space.
- **Surface**: Performative. Alive, adaptive, curated.
- **Rack**: Precise. Every parameter, in chain order. X-ray.
- **Patch**: Topology. Node graph, connections, signal flow.
- **Tracker**: Grid. Events in time. The spreadsheet of music.

The toggle should communicate which *kind of view* you're in, not just which label is highlighted. Options (not mutually exclusive):
- Active view label is more prominent (larger, brighter, different weight)
- Inactive labels recede further (lower contrast, smaller)
- The active view's accent color or character bleeds slightly into the toggle
- The toggle container subtly reflects the active view's register (Surface = warmer, Rack = cooler/more neutral)

Keep it compact — this lives in the top bar's 36px height. The change is tonal, not spatial.

### 3.5 Borders and dividers

Replace the current ad-hoc border vocabulary with three levels:

**Structure borders** — zone boundaries. Top bar bottom edge, footer top edge, track sidebar left edge, chat sidebar left edge. One color, one opacity, one weight. These are the seams of the instrument's enclosure.

**Subdivision borders** — dividers within a zone. Vertical separators in the top bar (between project menu, view toggle, transport, undo). Horizontal dividers in the track sidebar. These are the panel lines within a zone.

**Accent borders** — selection and identity. Active track highlight, active view indicator, Surface module borders (driven by `TrackVisualIdentity`). These carry color and are the only borders that change.

Concrete values to be determined during implementation, but the principle is: every border in the app belongs to one of these three categories, and each category has exactly one treatment.

---

## 4. The Canvas

The canvas is the content area where views render. It is the open space that the frame contains.

### 4.1 Canvas vs chrome distinction

The canvas should feel like a *space*, not a *surface*. Where the chrome is dense and opaque (a panel you look at), the canvas is open and deep (a field you look into). The simplest version of this: the canvas background is slightly different from the chrome background — warmer, or very slightly lighter, or subtly textured. Just enough that when your eye moves from the top bar into the content area, it registers crossing a boundary from housing into workspace.

This distinction already exists in the chat sidebar (the violet-tinted `ai-space` background). The canvas needs its own version — not violet, but distinct from chrome.

### 4.2 Canvas for each view

Each view has different spatial needs:

**Surface canvas**: The most expressive. The react-grid-layout modules sit on this field. The field itself can be influenced by the Surface Score (when implemented) — background tone, ambient density. For now, the canvas should feel open and receding so the modules are foregrounded.

**Rack canvas**: Precise, structured. Modules in chain order, horizontal scroll. The canvas is a neutral ground for parameter panels — should feel like a workbench, not a performance space. Slightly cooler or more neutral than the Surface canvas.

**Tracker canvas**: Dense grid. The canvas is the grid itself — row lines, column lines, the data. Minimal embellishment — legibility is everything.

**Patch canvas**: Spatial. Node graph with edges. The canvas needs to feel unbounded — you can pan and zoom. Background should support visual tracking of connection lines.

For the initial frame work, the canvas for all views can share one treatment. View-specific canvas differentiation is a refinement that follows.

---

## 5. Surface Within the Frame

Once the frame is solid, Surface has a stage to perform on. The Surface-specific visual improvements build on both the frame work and the existing visual identity infrastructure.

### 5.1 Module visual consumption

The most immediate Surface improvement: make modules actually consume the visual context they already receive. Currently, most modules call `getAccentColor()` and ignore everything else. The `ModuleVisualContext` already provides `weight`, `edgeStyle`, and `prominence`. These should be visible:

- **Weight** affects module visual density — border thickness (already mapped in `getModuleContainerStyle`), but also background opacity, shadow depth, or inner glow intensity. A heavy bass module should feel denser than a light hi-hat module.
- **Edge style** affects border treatment — `crisp` (hard edges, no radius), `soft` (rounded, feathered), `glow` (ambient light). Already mapped to border-radius and box-shadow, but the differences are too subtle to notice.
- **Prominence** affects visual foregrounding — opacity (already mapped), but could also influence scale, z-index layering, or whether the module has a subtle elevation shadow.

This requires no new infrastructure — just making the existing `getModuleContainerStyle()` output more visually distinct across the range.

### 5.2 Track differentiation

The north star says tracks should look and feel different. The AI tool `set_track_identity` already lets the AI set colour, weight, edge style, and prominence per track. But the visual difference between a heavy bass track (weight: 0.8, prominence: 0.7) and a light hi-hat track (weight: 0.2, prominence: 0.3) is barely perceptible.

Amplify the range. A heavy track's modules should have visible mass — thicker borders, deeper shadows, more saturated accent color. A light track's modules should feel thin and airy — hairline borders, minimal shadow, desaturated accent. The visual identity system already has the data; the rendering needs to express it more boldly.

### 5.3 The XY Pad standard

The XY Pad is the best-designed module. It uses canvas rendering with:
- Fine and major grid lines at calibrated opacities
- Radial glow gradient from the cursor
- Variable-alpha accent color throughout
- Spaced uppercase axis labels
- Value readouts that appear on hover

This is the quality bar for all modules. The Knob Group, Step Grid, Chain Strip, and Pad Grid should reach this level of visual refinement — not by copying the XY Pad's specific treatments, but by investing the same care in how accent color, opacity, and spatial rhythm are applied.

### 5.4 Surface Score implementation (future)

The Surface Score system (`docs/briefs/visual-language.md`) describes six domains of visual identity that the AI can curate. The frame work and module refinement described above are **prerequisites** for the Score system — they establish the rendering vocabulary that the Score would drive.

When the frame is solid and modules consume their visual context effectively, implementing the Score becomes a matter of wiring the derivation pipeline: `ScorePalette + track state → CSS custom properties (or canvas parameters) → module rendering`. The design tokens introduced during frame work become the variables the Score system writes to.

The Score domains, in order of implementation priority:
1. **Palette** (project-level color identity) — extends the existing warm zinc theme with per-project hue and saturation
2. **Track Identity** (extends `TrackVisualIdentity`) — adds glyph, motion signature
3. **Material** (frequency→weight, density→opacity, transient→edge) — auto-derives visual properties from audio analysis
4. **Motion** (pulse, parameter animation, modulation display) — the first animation system
5. **Atmosphere** (responsive density, mood) — project-level ambient visual treatment
6. **Relationships** (cross-track visual effects) — frequency proximity, sidechain ducking visuals

Domains 1-2 build directly on the frame work. Domains 3-6 require additional audio analysis and animation infrastructure.

---

## 6. Design Tokens

A design token layer is the mechanical foundation for all of the above. Instead of hardcoded Tailwind classes, every visual decision references a token. The token layer has three purposes:

1. **Consistency.** One source of truth for each visual decision.
2. **Differentiation.** Tokens can be scoped per-zone (chrome vs canvas vs AI space).
3. **Score readiness.** When the Surface Score pipeline is implemented, it writes to tokens rather than individual component styles.

### Token categories

**Surface tokens** (backgrounds, foregrounds):
```css
--gluon-chrome-bg        /* top bar, footer, track sidebar */
--gluon-chrome-bg-hover  /* interactive chrome elements */
--gluon-canvas-bg        /* content area default */
--gluon-ai-bg            /* chat sidebar */
```

**Border tokens**:
```css
--gluon-border-structure    /* zone boundaries */
--gluon-border-subdivision  /* within-zone dividers */
--gluon-border-accent       /* selection, identity — often dynamic */
```

**Typography tokens**:
```css
--gluon-text-primary     /* high-contrast text */
--gluon-text-secondary   /* medium-contrast text */
--gluon-text-muted       /* low-contrast text, labels */
--gluon-text-ghost       /* barely visible, metadata */
```

**Spacing tokens** (tighter set than Tailwind's full scale):
```css
--gluon-space-xs   /* 2px — within a control */
--gluon-space-sm   /* 4px — between related elements */
--gluon-space-md   /* 8px — between groups */
--gluon-space-lg   /* 16px — between zones */
```

### Implementation

Tokens are defined as CSS custom properties in `index.css` within the existing `@theme` block (or a dedicated `:root` block). Components reference them via Tailwind's `theme()` function or inline `var()`. Migration is incremental — one component at a time, old and new can coexist.

---

## 7. Implementation Sequence

Work proceeds outside-in: frame first, then canvas, then Surface refinement, then Score pipeline.

### Step 1: Design tokens

Define the token vocabulary in `index.css`. Migrate the most-used values (backgrounds, borders, text colors) first. Components adopt tokens incrementally.

**Files:** `src/index.css`
**Risk:** Zero — additive, no visual change until components adopt tokens.

### Step 2: Chrome vs canvas hierarchy

Apply the chrome/canvas background distinction. Top bar, footer, and track sidebar get chrome treatment. Content area gets canvas treatment. This is the single biggest perceptual shift.

**Files:** `src/ui/AppShell.tsx`, `src/index.css`
**Risk:** Low — background color changes, easily reversible.

### Step 3: Border system

Replace ad-hoc borders with the three-level system. Structure borders on zone boundaries, subdivision borders within zones, accent borders for selection.

**Files:** `src/ui/AppShell.tsx`, `src/ui/TrackList.tsx`, `src/ui/TrackRow.tsx`, `src/ui/TransportStrip.tsx`, `src/ui/ChatSidebar.tsx`
**Risk:** Low — cosmetic, but touches many components.

### Step 4: Typography scale

Reduce the font size vocabulary. Establish chrome-label, control-value, and supporting-text tiers. Apply consistently across frame components.

**Files:** `src/ui/TransportStrip.tsx`, `src/ui/TrackRow.tsx`, `src/ui/ViewToggle.tsx`, `src/ui/AudioLoadMeter.tsx`, `src/ui/MasterStrip.tsx`
**Risk:** Low — may require visual tuning.

### Step 5: View toggle refinement

Give the active view more presence. Make inactive views recede. The toggle should communicate the character of the current mode.

**Files:** `src/ui/ViewToggle.tsx`
**Risk:** Low — single component.

### Step 6: Transport refinement

Sharpen the transport controls: more contrast on active states, the bar:beat display as the visual anchor, hardware-button feel on play/stop/record.

**Files:** `src/ui/TransportStrip.tsx`
**Risk:** Low — single component.

### Step 7: Surface module visual amplification

Make modules consume their full `ModuleVisualContext`. Amplify the visible range of weight, edge style, and prominence. Bring all modules toward the XY Pad quality bar.

**Files:** `src/ui/surface/visual-utils.ts`, `src/ui/surface/KnobGroupModule.tsx`, `src/ui/surface/StepGridModule.tsx`, `src/ui/surface/ChainStripModule.tsx`, `src/ui/surface/PadGridModule.tsx`
**Risk:** Medium — visual changes to the most-used view.

### Step 8: Track visual differentiation

Amplify the visual range of `TrackVisualIdentity` in both the Stage cards and the Surface modules. A bass track and a hi-hat track should be visually distinct at a glance.

**Files:** `src/ui/TrackRow.tsx` (stage variant), `src/ui/surface/visual-utils.ts`, `src/engine/visual-identity.ts`
**Risk:** Medium — affects how every track appears.

### Step 9: Surface Score pipeline (future)

Wire the Score derivation: `SurfaceScore + track state → CSS custom properties → module rendering`. The tokens from Step 1 become the variables the Score writes to.

**Files:** New `src/engine/surface-score.ts`, `src/ui/surface/visual-utils.ts`, AI tool schemas
**Risk:** Higher — new system, audio analysis dependency for Material domain.

---

## 8. Visual Inspection Checkpoints

Every step should be verified visually before committing. The criteria for each:

| Step | What to verify |
|------|---------------|
| Tokens | No visual change — verify values match current appearance |
| Chrome vs canvas | The content area reads as a distinct, lighter space inside darker housing |
| Borders | All borders feel intentional; no orphaned or inconsistent treatments |
| Typography | Text hierarchy is clear; no orphaned sizes; chrome labels are uniform |
| View toggle | Active view has clear presence; switching views feels like changing mode |
| Transport | Play/stop feel like buttons; bar:beat and BPM are the visual anchors |
| Module visuals | Heavy and light tracks produce visibly different modules; glow/soft edges visible |
| Track differentiation | Bass and hi-hat tracks are distinguishable at a glance in Stage cards |

---

## 9. Visual Audit Findings (Playwright, 2026-03-19)

A hands-on walkthrough of the live app at 1440x900 revealed issues that the code review alone didn't surface. Screenshots saved to `screenshots/` for reference.

### Chat view — the primary interface

**Empty state problem.** First load shows an enormous black void with a small music note icon and four prompt starters floating in the center. There is no sense that this is a music tool. The "GLUON" label is a faint violet whisper. The composer bar is the brightest element on screen but it's pinned to the very bottom edge with ~700px of void above it. A new user lands here with no orientation.

**Action log overwhelms the response.** After the AI creates a kick drum (29 parameter changes), the visible content is ~80% raw monospaced action log entries and ~20% the AI's conversational text. You have to scroll past a full screen of diffs (KICK eq/mid1-gain 0.50 → 0.30, etc.) to reach the natural language explanation. The summary card at the bottom ("Changed: ... + 26 more / Why: I've set up a deep...") is exactly the right abstraction — but it appears *after* the raw log instead of *before* it. The action log should be collapsed by default.

**Composer pill looks foreign.** The white/cream composer bar is strikingly bright against the dark warm background. It looks like a search bar from a different application was dropped into a dark terminal. It needs to feel native to the warm dark palette.

**Message structure is minimal.** "YOU" and "GLUON" labels are small uppercase text with thin left borders. There's no breathing room, no avatars, no visual containers that create conversational rhythm. Messages blur into each other.

**"AI Connected" / "API Connected" badges** in the top-right look like developer debug output, not user-facing status.

### Surface view — empty state failure

**The worst screen in the app.** After the AI just performed 29 actions to set up a complete kick drum with EQ and compression, switching to Surface shows: "No surface modules configured." The AI didn't configure Surface modules as part of its setup. This is a product gap — the most promoted view is dead on arrival. The main canvas is a ~600px empty void with orphaned "KICK" text and Vol/Pan knobs in the top corners.

### Rack view — the best view

**The Rack actually looks great.** The horizontal module panels (Plaits, Parametric EQ, Compressor) with amber knob arcs on dark backgrounds feel like a real instrument. The chain strip provides clear orientation. This is the one view where "soft machinery" is partially achieved. It should be the visual reference standard for everything else.

**Minor issues:** Plaits panel crams 10 knobs with no hierarchy between primary (Frequency, Harmonics, Timbre, Morph) and secondary controls (Timbre Mod, FM Amount, etc.). Pin-to-Surface icons on every knob row are visually noisy. "Timbre M..." is truncated.

### Patch view — needs significant work

**The Source node is absurdly tall.** Analog Bass Drum lists 8 input ports + 2 outputs, making a ~250px tall rectangle that dwarfs the EQ and Compressor nodes. It looks like a data dump, not a signal flow diagram.

**Parameter labels overlap.** Below the EQ node, the 10 parameter names run together ("low-freqlow-gainmid1-freq...") because they're positioned as bottom-hanging labels but the 180px node width can't fit them.

**Nothing looks interactive.** No affordances suggest you can click, drag, or connect anything. Ports are tiny colored dots. Connection lines are thin and barely visible. The graph looks like a static diagram, not an interactive tool. Compare to Max/MSP or Cables.gl where the graph invites manipulation.

**The Output terminal** is a grey circle with "Output" text that looks like an unfinished placeholder.

**Layout doesn't auto-fit.** Nodes sit in the bottom-left quadrant with ~350px of dead space above. The "Fit to view" button exists but doesn't fire on load. At 104% zoom, the graph feels uncentered and accidental.

### Tracker view — clean and correct

The tracker grid is the most legible view. Four-on-the-floor pattern clearly visible, playhead tracking works, transform buttons are clean. This view knows what it wants to be. No major issues.

### Track sidebar — barely visible

At 192px wide with only 2 tracks, the sidebar is mostly empty space. Thumbprint dots are 8px — barely visible. Level meters are thin. The Stage variant (Surface view) is slightly better with accent bars and role text, but still sparse.

### Footer — invisible

At 28px with zinc-on-zinc text ("CPU", "1:1", "PATTERN", "2 tracks"), the footer is practically invisible. Useful status information that nobody will notice.

### Top bar — undifferentiated

Functional but uniform. View toggle pills, transport buttons, undo/redo — all the same visual weight at 11px. Record, loop, and PAT buttons are ambiguous small circles. The bar:beat display and BPM are correctly the most prominent elements.

---

## 10. What This Does Not Define

**Exact color values.** Token values will be tuned during implementation with visual inspection. The principle (chrome darker/denser, canvas lighter/more open) is specified; the hex codes are not.

**Animation and motion.** The Motion domain of the Surface Score (pulse, breathing, modulation display) is deferred. The frame work is entirely static. Motion is a separate effort that builds on the Score pipeline (Step 9).

**Individual module redesign.** Module visual amplification (Step 7) makes existing modules consume their visual context more effectively. It does not redesign individual module layouts or introduce new rendering techniques.

**Chat sidebar changes.** The AI space already has its own visual identity (violet tint, breathing animation, backdrop blur). It is the most designed zone and does not need frame-phase work.

**Canonical view content.** Rack, Tracker, Patch view internals are not addressed here. The canvas treatment (Step 2) affects their background, but the content within each canonical view is a separate effort.

---

## 11. Relationship to Other Documents

| Document | Relationship |
|----------|-------------|
| `docs/briefs/visual-language.md` | Defines the Surface Score schema. This brief is the implementation path that makes Score consumption possible. Steps 1-8 are prerequisites for Score implementation (Step 9). |
| `docs/rfcs/surface-north-star.md` | Defines the full Surface vision including module composition, AI curation, visual identity. This brief addresses the visual rendering layer that the north star assumes exists. |
| `docs/rfcs/view-architecture.md` | Defines the four-view model and canonical/custom split. The chrome/canvas distinction in this brief is the visual expression of that architectural split. |
| `docs/design-references.md` | Guitar Rig (rack inline), Bitwig (modulation display), Reason (physical routing), OP-1 (playful screens). The frame work draws on the "precision instrument housing" quality of these references. |
| `docs/rfcs/ai-curated-surfaces.md` | Defines AI surface operations. Visual amplification (Steps 7-8) makes the AI's `set_track_identity` tool produce visibly meaningful results. |

---

## 12. Success Criteria

The frame work succeeds if:

1. A new user's first impression is "this is a real instrument" rather than "this is a developer tool."
2. The content area feels like a space you look *into*, distinct from the chrome you look *at*.
3. Every border in the app feels intentional — no arbitrary treatments, no inconsistencies.
4. The top bar reads as a hardware fascia — dense, precise, the transport section as the anchor.
5. Switching views feels like changing mode on an instrument, not switching tabs in a web app.
6. Tracks with different visual identities are distinguishable at a glance.
7. Surface modules for a bass track look and feel different from Surface modules for a hi-hat track.
8. The frame establishes a quality bar that the Surface Score system can rise to meet.
