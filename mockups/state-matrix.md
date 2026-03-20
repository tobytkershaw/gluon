# Gluon UI State Matrix

Implementation checklist covering every state per screen area. Derived from mockups 08, 11, 12, 13, 14, 17.

---

## Shared Frame

### Top Bar

**Tab Navigation**
- [ ] Chat tab inactive (text-muted, no bg)
- [ ] Chat tab active (violet-400, violet/10 bg)
- [ ] Instrument tab inactive (text-muted, no bg)
- [ ] Instrument tab hover (text-secondary, bg-raised)
- [ ] Instrument tab active (amber-400, amber/10 bg) -- one of Surface, Rack, Patch, Tracker
- [ ] Exactly one tab active at all times

**Project Menu**
- [ ] Named project, saved (green dot, 50% opacity)
- [ ] Named project, unsaved changes (amber dot, full opacity)
- [ ] Long project name (truncated with ellipsis, max-width 120px)
- [ ] Untitled project (default name shown)
- [ ] Chevron present, hover shows bg-raised

**Transport**
- [ ] All four buttons always visible in fixed-width zone (play, stop, record, loop)
- [ ] Stopped -- all buttons in rest state
- [ ] Playing -- play button active (amber)
- [ ] Recording -- record button pulsing (rose), play button active
- [ ] Loop active -- loop button lit (cyan)
- [ ] Recording + loop active simultaneously
- [ ] Meter bars animate during playback, flat at rest

**Pattern / Song Toggle**
- [ ] Pattern mode selected (Pat active)
- [ ] Song mode selected (Song active)

**Time Display**
- [ ] Position counter (0:00 when stopped, counting during playback)
- [ ] BPM display (editable value)
- [ ] Swing percentage display (Sw 50% default, variable)

**Peak Meter**
- [ ] Idle / silent (minimal height bars)
- [ ] Active audio (bars animate with level)

**A/B Compare**
- [ ] Inactive -- single "A/B" button
- [ ] Active, A selected -- A highlighted amber, B dimmed, clear button visible
- [ ] Active, B selected -- B highlighted amber, A dimmed, clear button visible
- [ ] Fixed-width zone (76px) -- no layout shift between states

**Undo / Redo**
- [ ] Both available
- [ ] Undo available, redo disabled (0.3 opacity)
- [ ] Both disabled (empty project)
- [ ] Tooltip shows last action description ("Undo: Created Kick track")

**Status Dot**
- [ ] Active -- violet, breathing animation (AI processing)
- [ ] Connected -- teal, solid (AI idle)
- [ ] Connected, no audio eval -- teal dot with amber ring
- [ ] Manual mode -- amber, solid
- [ ] Disconnected -- zinc/gray (no AI connection)

**Wordmark**
- [ ] "gluon" text always visible between undo group and status dot

---

### Sidebar (Instrument Tabs Only)

**Header**
- [ ] "Tracks" label with "+ Track" and "+ Bus" buttons
- [ ] Add buttons hover state (bg-raised, text-secondary)

**Track Rows**
- [ ] Normal state (collapsed, unselected)
- [ ] Selected state (bg-raised)
- [ ] Hover state (bg-raised)
- [ ] Active pulse (amber flash, fades out over 2s -- AI just modified this track)
- [ ] Expanded state (chevron rotated 90deg, mixer controls visible)
- [ ] Collapsed state (chevron pointing right)

**Track Types**
- [ ] Audio track (round color thumb)
- [ ] Bus track (square thumb, zinc-600, "bus" role label)
- [ ] Master bus (anchored at sidebar bottom, separate section)

**Track Controls**
- [ ] Mute off (M, text-faint)
- [ ] Mute on (M, rose-400, rose bg -- label strike-through, meter zeroed)
- [ ] Solo off (S, text-faint)
- [ ] Solo on (S, amber-400, amber bg)
- [ ] Record arm off (R, text-faint)
- [ ] Record arm on (R, rose-400, rose bg with border)
- [ ] Bus tracks -- M and S only, no R

**Claim Toggle**
- [ ] Unclaimed (circle outline, text-faint -- AI can freely modify)
- [ ] Claimed (hand icon, orange #e07840 -- AI must ask permission)

**Expanded Section**
- [ ] Volume knob with dB value
- [ ] Pan knob with L/C/R value
- [ ] Sends list with per-send level knob and remove button
- [ ] "+ Add send" link
- [ ] Freeze button (normal state)
- [ ] Freeze button (frozen -- cyan highlight)

**Track Groups**
- [ ] Group label with fold arrow (open/collapsed)
- [ ] Grouped tracks indented (padding-left 14px)

**Bus Section**
- [ ] Buses separated from audio tracks (border-top)
- [ ] Bus input indicator ("<-- Kick, Lead")

**Master Bus**
- [ ] Always anchored at bottom
- [ ] Meter + label + volume knob

**Empty State**
- [ ] No tracks -- sidebar shows only header with add buttons

---

### Footer

- [ ] CPU meter (label + bar, green fill when low)
- [ ] Position display (tabular-nums)
- [ ] Mode label (PATTERN or SONG, uppercase)
- [ ] Track count ("3 tracks")
- [ ] BPM display
- [ ] Peak meter (stereo bars, green-to-amber gradient)
- [ ] AI dot (idle: violet 0.4 opacity; working: pulsing)

---

### The Coin

**Chat Tab**
- [ ] Coin visible bottom-right, dot in text-faint (idle)
- [ ] Hint label below: "{last instrument tab} Cmd+K"
- [ ] Click or Cmd+K switches to last instrument tab

**Instrument Tabs -- Idle**
- [ ] Coin visible bottom-right, dot in text-faint
- [ ] Hint label below: "Chat Cmd+K"
- [ ] Click or Cmd+K switches to Chat

**Instrument Tabs -- Working**
- [ ] Card attached to coin's left (card + coin = pill shape)
- [ ] Three animated dots + "Thinking..." text
- [ ] Coin dot pulses in emerald

**Instrument Tabs -- Needs Attention**
- [ ] Card with question text (e.g. "Which scale for the bass line?")
- [ ] Coin dot solid amber with glow

**Instrument Tabs -- Task Complete**
- [ ] Card with completion text (e.g. "Done: added hi-hat pattern")
- [ ] Coin dot solid emerald
- [ ] Auto-dismisses back to idle state

**General**
- [ ] Card max-width 280px
- [ ] Card appears on instrument tabs only, never on Chat tab
- [ ] Coin never moves position, never changes shape
- [ ] Remembers which instrument tab user came from

---

## Chat Tab

### Empty / Onboarding

- [ ] "gluon" wordmark centered
- [ ] "What do you want to make?" subtitle
- [ ] Prompt starter chips (clickable, hover state)
- [ ] Composer at bottom with placeholder text
- [ ] No Live Controls panel visible

### Conversation -- Messages

- [ ] User message: "You" label (mono, uppercase), body text
- [ ] AI message: "Gluon" label (violet, mono, uppercase), body text
- [ ] AI options list (bold option name + description, e.g. framing phase)
- [ ] Turn separator (horizontal line between turn pairs)

### Conversation -- Tool Use

- [ ] Tool group (multiple tool-use blocks stacked with 2px gap)
- [ ] Tool block collapsed: chevron + color bar + summary + checkmark + undo button
- [ ] Tool block expanded: detail section with param key/value pairs
- [ ] Undo button appears on hover only (opacity 0 -> 1)
- [ ] Color bars by type: source (amber), processor (sky), pattern (emerald-ish), param (distinct), surface (distinct)

### Conversation -- Streaming

- [ ] Partial AI text with blinking cursor (violet, 1s blink cycle)
- [ ] Streaming indicator visible during generation

### Conversation -- Error

- [ ] Error state for failed AI responses (not yet mockup'd -- needs design)

### Audition Control

- [ ] Play button (amber circle, play icon)
- [ ] Track pills with per-track colors
- [ ] Bar range label ("bars 1-2")
- [ ] Mode badge ("LOOP")
- [ ] Playing state vs stopped state

### Listen Card

- [ ] Play button (violet circle)
- [ ] Waveform visualization (rendered audio)
- [ ] Duration label ("4.0s")
- [ ] Scope label ("full mix")
- [ ] With AI assessment text below (italic, indented)
- [ ] Without AI assessment (card only, no text below)

### Live Controls Panel

- [ ] Panel visible (right side, violet border-left)
- [ ] Panel header with presence dot and "Live Controls" title
- [ ] Module card: header with title + "Live" tag + "Add to Surface" button
- [ ] Module card: knob controls with labels and values
- [ ] Module card: mini piano roll (Bass Notes style)
- [ ] Empty hint text: "Controls appear here as Gluon works"
- [ ] Multiple modules stacked vertically

### Composer

- [ ] Empty state (placeholder text: "Ask Gluon anything...")
- [ ] Typing state (text visible, send button becomes "ready" -- violet bg)
- [ ] Focus state (violet border glow on composer row)
- [ ] Send button default (text-muted, bg-surface)
- [ ] Send button ready (violet-500 bg, white icon)
- [ ] Stop button during streaming (not yet mockup'd -- needs design)

---

## Rack View

### Chain Strip

- [ ] Source badge (amber bg/border, e.g. "Plaits")
- [ ] Processor badge (sky bg/border, e.g. "Ripples", "Compressor")
- [ ] Output badge (bg-raised, text-muted)
- [ ] Active/selected badge (thicker border)
- [ ] Arrow separators between badges

### Module Area

- [ ] Modules laid out with flex-wrap, gap spacing
- [ ] Module browser hint tab (left edge, chevron, hover state)

### Module Card

- [ ] Header: accent bar (color by type) + bypass dot + name + type label
- [ ] Bypass dot green (active), bypassed state (needs design)
- [ ] Module claim: claimed (hand icon, orange) or unclaimed (circle, text-faint)
- [ ] Selected module (amber border + box-shadow)
- [ ] Unselected module (default border)

### Module Knobs (Three Tiers)

- [ ] Primary knobs (52px, labeled section)
- [ ] Secondary knobs (42px, labeled section)
- [ ] Tertiary knobs (32px, labeled section)
- [ ] Each knob: label above, arc indicator, value below
- [ ] Knob at zero (no arc fill)
- [ ] Knob at partial value (proportional arc)
- [ ] Knob at full value (complete arc)

### Discrete Controls

- [ ] Mode selector button (e.g. "Virtual Analog")
- [ ] Multi-option selector (e.g. LP2 | LP4 | BP2 | HP2 with active highlighted)

### Empty State

- [ ] No modules in chain (empty module area)
- [ ] Module browser hint still visible

---

## Patch View

### Toolbar

- [ ] Zoom controls (-, percentage, +)
- [ ] Snap toggle (active state: amber)
- [ ] Auto-layout button

### Canvas

- [ ] Background grid pattern (20px spacing)
- [ ] Port legend (Audio = amber, CV = emerald, Gate = rose)

### Nodes

- [ ] Source node (amber accent bar, e.g. Plaits)
- [ ] Processor node (sky accent bar, e.g. Ripples)
- [ ] Modulator node (violet accent bar, e.g. Tides)
- [ ] Output terminal (small circle with "OUT" label)
- [ ] Node header: accent bar + name + type label
- [ ] Input ports on left edge (colored circles: amber=audio, emerald=CV, rose=gate)
- [ ] Output ports on right edge (same color coding)
- [ ] Port labels (mono text, left-aligned for inputs, right-aligned for outputs)

### Cables

- [ ] Audio cable (amber, solid, 2px)
- [ ] Modulation cable (emerald, dashed, 1.5px)
- [ ] Modulation depth label on cable (small badge with value, e.g. "+0.45")
- [ ] Cable dragging preview (dashed, low opacity, endpoint circle)

### Node Selection

- [ ] Node selected (needs distinct visual -- not explicitly mockup'd)
- [ ] Node unselected (default border)

### Empty State

- [ ] No nodes on canvas (grid visible, no elements)

---

## Tracker View

### Toolbar

- [ ] Pattern length buttons (16, 32)
- [ ] Edit tools: Rotate, Transpose, Quantize, Clear

### Pattern Tabs

- [ ] Active pattern tab (amber bg, amber text)
- [ ] Inactive pattern tab (text-muted, hover bg-raised)
- [ ] Pattern-level claim: claimed (hand icon) or unclaimed (circle)
- [ ] Multiple pattern tabs visible (P00, P01, P02...)

### Grid

- [ ] Column headers (Pos, Ch1, Vel, Dur, Ch2, Vel, Dur, FX) -- sticky top
- [ ] Channel divider (border-left on Ch2 column)
- [ ] Row numbers (hex, right-aligned, text-faint)
- [ ] Empty cell ("---" or "--", text-faint)
- [ ] Note cell (e.g. "C-4", text-primary, bold)
- [ ] Velocity cell (hex value, zinc-400)
- [ ] Duration cell (value, zinc-500)
- [ ] FX cell (value, sky-400)
- [ ] Trigger cell ("TRG", amber-400, bold)
- [ ] Beat row highlight (every 4 steps, subtle bg tint)
- [ ] Row with notes highlight (emerald tint)
- [ ] Playhead row (amber tint, moves during playback)
- [ ] Cell cursor (amber outline on selected cell)

### Sequence Editor (Song Mode Panel)

- [ ] "Song Mode" header
- [ ] Sequence slots: index + pattern reference
- [ ] Active slot (amber bg tint)
- [ ] Reused pattern indicator (cyan text for repeated pattern refs)

### Playback States

- [ ] Stopped (no playhead visible)
- [ ] Playing in pattern mode (playhead moves within single pattern)
- [ ] Playing in song mode (playhead follows sequence order)

### Empty State

- [ ] No patterns created (empty grid area)

---

## Surface (Placeholder -- To Be Designed)

### Scope

- [ ] Track mode (modules for selected track)
- [ ] Project mode (modules across tracks)

### Module States

- [ ] Empty (no modules configured for track/project)
- [ ] Modules populated (curated control layout)
- [ ] Module claimed (hand icon, AI must ask)
- [ ] Module unclaimed (AI can freely modify)

### Stage Cards

- [ ] Stage card presence (per-track identity)
- [ ] Visual identity / surface score applied

### Notes

- [ ] Full Surface design requires dedicated session (per design_surface_needs_session.md)
- [ ] Current mockups are structural placeholders
- [ ] Module types: knob, pattern, note, waveform, XY, meter, identity (from Surface RFC)
