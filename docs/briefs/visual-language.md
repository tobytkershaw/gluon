# Surface Score

## The Idea

Gluon's Surface view is a visual instrument layer. The AI composes a **Surface Score** — a structured description of the project's visual identity, performative emphasis, and motion behaviour — derived from the music itself.

The Surface Score is to visual identity what the AI-curated control surface is to parameter layout. The AI reads the musical state, understands character and intent, and generates a visual language that fits. Different projects feel visually distinct. Different tracks have their own identity. The interface is alive because the music is alive.

This is not a theme picker. It is not a visualiser. It is a bounded, regenerable visual grammar that the AI composes within safe constraints, and that the human can override, edit, or reset at any time without risk to the musical state.

---

## The Split: Canonical Views vs Surface

The four-view architecture (see `docs/rfcs/view-architecture.md`) creates two intentionally different visual registers:

**Canonical views (Tracker, Rack, Patch)** are the x-ray views. Exact, stable, inspectable, legible. They are the source of truth for the data model.

- Precise
- Sparse
- Stable
- Functional
- Source of truth

**Surface** is the performative view. Expressive, alive, adaptive. It is where the human plays, feels, and directs.

- Expressive
- Alive
- Adaptive
- Playful
- Atmospheric
- Performance-oriented

This split is a strength. Canonical views are for inspection, editing, and trust. Surface is for playing, feeling, and directing. The contrast reinforces both purposes — switching to the Rack feels like putting on x-ray glasses. Switching to the Surface feels like picking up the instrument.

---

## Design Principles

### 1. Canonical remains trustworthy

Tracker, Rack, and Patch must stay crisp and dependable. They do not inherit decorative treatment from the Surface. They are quiet, structured, exact.

### 2. Surface feels alive

The Surface communicates that AI, sound, and control are active forces in the system. The interface breathes, responds, and reflects the music's character.

### 3. AI curates, not hallucinates

The AI works through bounded tools and structured parameters — not arbitrary layout, not arbitrary CSS, not raw rendering power. It operates within a constrained visual grammar and composes a Surface Score from defined primitives. The visual language is a system the AI populates, not a canvas it paints freehand.

### 4. Project identity emerges

Different projects should feel visually distinct without losing usability. The visual identity comes from the music's character, not from a settings menu.

### 5. Surface is disposable

The Surface is always a layer over canonical truth. It can be regenerated, edited, or reset without risk to the musical state. The human should never worry that changing the visual language loses work. Resetting the Surface Score restores a clean default. Canonical views are unaffected.

### 6. Motion is metabolic, not decorative

Every motion carries information. Breathing reflects tempo. Pulsing reflects modulation. Visual ducking reflects sidechaining. Animation without semantic purpose is noise. Motion should be legible, low-frequency, tied to real state, and removable if distracting.

---

## Visual Direction

**Soft machinery with bioelectric accents.**

Desired qualities:
- Warm rather than sterile
- Animated rather than static
- Tactile rather than flat
- Slightly uncanny rather than generic
- Musical rather than dashboard-like

Avoid:
- Generic dark-mode synth UI
- Cyberpunk/neon gradients
- SaaS glassmorphism
- Skeuomorphism (fake materials referencing physical objects)
- Ornamental animation without semantic purpose
- Spectrogram-as-wallpaper

---

## The Surface Score

The Surface Score is a structured schema that describes the project's visual identity. It is authored by the AI, stored on the project, and editable by the human. It drives how every Surface module renders.

The Score has six domains:

### 1. Palette

The project-level colour identity. A mapping from musical properties to colour — not a fixed palette, but a generative one. Colours emerge from the sound.

**What the AI defines:**
- A base hue range for the project (derived from overall timbral character)
- How tracks distribute within that range (by frequency register, brightness, role)
- Saturation rules (dense/busy tracks more saturated, sparse tracks more muted)
- A brightness floor (ensures readability — colours enhance, never obscure)
- Contrast level and luminosity range

**How it behaves:**
- A dark, sub-heavy bass track casts a deep indigo wash across its Surface region
- A bright, metallic lead has a warm amber glow
- A noisy, textured percussion track is desaturated, grey-white
- When the AI changes a sound ("make it darker"), the track's colour responds — the human sees the timbral shift before hearing it
- The overall project has a colour identity that emerges from the music

```ts
interface ScorePalette {
  // How musical properties map to hue
  hueSource: 'timbral' | 'harmonic' | 'energy' | 'custom';

  // Hue range for the project (degrees, 0-360)
  hueRange: [number, number];

  // How saturation responds to musical density
  saturationRange: [number, number];  // [sparse, dense]

  // Brightness constraints (readability floor)
  brightnessRange: [number, number];  // [minimum, maximum]

  // Overall contrast and texture level
  contrast: number;       // 0.0 (flat) to 1.0 (high contrast)
  textureLevel: number;   // 0.0 (clean) to 1.0 (textured/grainy)
  edgeSoftness: number;   // 0.0 (crisp) to 1.0 (diffuse)
}
```

### 2. Track Identity

Per-track visual identity. Each track gets a colour, an optional glyph, a motion signature, and a prominence level — all derived from its musical role.

**What the AI defines:**
- Track colour (position in the project's colour space, derived from timbral character)
- Glyph or icon (a visual identity marker — wave shape, geometric form, or abstract symbol that captures the track's character)
- Motion signature (how this track's modules move — heavy and slow for bass, quick and light for hats)
- Prominence (how visually foregrounded this track is — lead voices are prominent, support textures recede)

**How it behaves:**
- A kick drum track: deep indigo, heavy circular glyph, slow dense pulse, moderate prominence
- A synth lead: warm amber, angular glyph, responsive motion, high prominence
- A background texture: desaturated, soft amorphous glyph, slow drift, low prominence
- The glyph appears on compact cards, module headers, and anywhere the track needs visual identification

```ts
interface ScoreTrackIdentity {
  trackId: string;

  // Colour (position in project colour space)
  colour: { hue: number; saturation: number; brightness: number };

  // Visual identity marker
  glyph: {
    shape: 'circle' | 'triangle' | 'square' | 'wave' | 'spike' | 'cloud' | 'custom';
    style: 'solid' | 'outline' | 'pulse' | 'breathe';
  };

  // How this track's modules move
  motionSignature: {
    weight: number;         // 0.0 (featherlight) to 1.0 (heavy/slow)
    responsiveness: number; // 0.0 (sluggish) to 1.0 (snappy)
  };

  // Visual foregrounding
  prominence: number;       // 0.0 (recedes) to 1.0 (foregrounded)
}
```

### 3. Material

How Surface modules feel — their visual weight, edge quality, and opacity. Derived from sonic character.

**What the AI defines:**
- How frequency register maps to visual weight (low sounds = heavy, dense; high sounds = light, thin)
- How pattern density maps to opacity (sparse = translucent, dense = solid)
- How transient character maps to edge quality (sharp attacks = crisp edges, slow attacks = soft/feathered)
- Overall border style for the project

**How it behaves:**
- A sub bass module has thick borders, deep shadows, feels planted — visually heavy
- A hi-hat module is thin, almost transparent, barely-there borders
- A pad with slow attack has soft, feathered edges that blur into the background
- A sharp pluck has crisp, well-defined edges
- As the AI changes a sound from soft to aggressive, the module's material responds — edges sharpen, weight increases, shadows deepen

```ts
interface ScoreMaterial {
  // Frequency register → visual weight
  weightFromFrequency: {
    enabled: boolean;
    lowWeight: number;      // visual weight for low-frequency tracks (0-1)
    highWeight: number;     // visual weight for high-frequency tracks (0-1)
  };

  // Pattern density → opacity
  opacityFromDensity: {
    enabled: boolean;
    sparseOpacity: number;  // e.g. 0.4 (translucent)
    denseOpacity: number;   // e.g. 1.0 (solid)
  };

  // Attack character → edge treatment
  edgeFromTransient: {
    enabled: boolean;
    sharpAttack: 'crisp' | 'hard-shadow';
    softAttack: 'feathered' | 'blur' | 'glow';
  };

  // Overall border style
  borderStyle: 'soft' | 'sharp' | 'none' | 'gradient';
}
```

### 4. Motion

How things move. The temporal character of the interface, derived from the music's rhythm and energy.

**What the AI defines:**
- Global pulse (tempo-synced, energy-driven, drift, or still)
- Parameter animation style (how values travel to new positions)
- Modulation display (how active modulation routes appear visually)
- Idle behaviour (what happens when nothing is being touched)
- AI activity indicators (thinking = inhale/ember pulse; acting = exhale/signal propagation)

**How it behaves:**
- In a 140bpm dubstep project, the Surface breathes at half-tempo — a slow, heavy swell
- In a sparse ambient project, elements drift almost imperceptibly
- When the AI moves a parameter, the value flows to its new position with easing that matches the project's character
- A parameter modulated by an LFO pulses at the LFO's rate — the visual IS the modulation
- A sidechained track visually ducks in sync with the compressor
- When the AI is thinking, a subtle ember pulse. When it acts, signal propagation ripples outward from the affected modules

```ts
interface ScoreMotion {
  // Global pulse behaviour
  pulse: {
    mode: 'tempo-synced' | 'energy-driven' | 'drift' | 'still';
    intensity: number;      // 0.0 (imperceptible) to 1.0 (prominent)
    subdivision: number;    // pulse rate relative to tempo (0.5 = half-time)
  };

  // How parameter values animate to new positions
  parameterMotion: {
    style: 'fluid' | 'snappy' | 'organic' | 'instant';
    durationMs: number;     // base transition duration
  };

  // How active modulation routes are displayed
  modulationDisplay: {
    style: 'breathe' | 'ripple' | 'glow' | 'bloom' | 'ring';
    syncToRate: boolean;    // match the modulator's rate
  };

  // Idle behaviour (nothing being touched)
  idle: {
    mode: 'still' | 'drift' | 'breathe';
    intensity: number;
  };

  // AI activity indicators
  aiActivity: {
    thinking: 'ember-pulse' | 'shimmer' | 'inhale' | 'none';
    acting: 'signal-propagation' | 'ripple' | 'exhale' | 'pulse';
  };
}
```

### 5. Atmosphere

The ambient, project-wide visual treatment. Responsive density and environmental effects that make the Surface feel like a space, not a panel.

**What the AI defines:**
- How visual richness responds to the music's complexity (sparse music = clean, open Surface; dense music = saturated, active Surface)
- Which musical properties drive atmospheric changes (track count, event density, parameter activity, energy)
- Overall mood treatment (warm/cool, bright/dark, calm/intense)

**How it behaves:**
- A minimal project with two sparse tracks: lots of negative space, muted colours, gentle motion
- A dense project with eight active tracks: more saturated, more visual activity, tighter spacing
- When the AI strips a section back ("make it minimal"), the Surface responds — colours desaturate, motion slows, visual weight decreases
- Building toward a drop increases visual intensity — not as a visualiser effect, but as the natural consequence of colour, motion, and material mappings responding to denser, louder, brighter music

```ts
interface ScoreAtmosphere {
  // Responsive density
  responsiveDensity: {
    enabled: boolean;
    drivers: ('track-count' | 'event-density' | 'parameter-activity' | 'energy')[];
    saturationResponse: number;   // how much saturation increases with density (0-1)
    motionResponse: number;       // how much motion intensity increases (0-1)
    spacingResponse: number;      // how much spacing tightens (0-1)
  };

  // Overall mood
  mood: {
    warmth: number;     // -1.0 (cool) to 1.0 (warm)
    brightness: number; // 0.0 (dark) to 1.0 (bright)
    intensity: number;  // 0.0 (calm) to 1.0 (intense)
  };
}
```

### 6. Relationships

Cross-track musical relationships rendered as ambient visual effects on the Surface. Not explicit wires (that is what the Patch view is for), but felt connections.

**What the AI defines:**
- Whether relationship visualisation is active
- Which relationship types to display (frequency proximity, rhythmic alignment, routing dependencies)
- How relationships are rendered (colour bleed, shared pulse, boundary glow)

**How it behaves:**
- Tracks that are sidechained share a visual pulse — the kick flashes, the bass visually ducks
- Tracks in similar frequency ranges have a subtle colour bleed at their borders — a visual hint of potential masking
- Tracks that are rhythmically locked breathe together
- When the AI creates a new connection, the visual relationship appears on the Surface before the human switches to Patch to see the explicit wiring

```ts
interface ScoreRelationships {
  enabled: boolean;

  frequencyProximity: {
    enabled: boolean;
    style: 'colour-bleed' | 'boundary-glow' | 'none';
    threshold: number;
  };

  rhythmicAlignment: {
    enabled: boolean;
    style: 'shared-pulse' | 'phase-indicator' | 'none';
  };

  routingDependencies: {
    enabled: boolean;
    style: 'ducking-animation' | 'flow-lines' | 'none';
  };
}
```

---

## The Combined Type

```ts
interface SurfaceScore {
  palette: ScorePalette;
  trackIdentities: ScoreTrackIdentity[];
  material: ScoreMaterial;
  motion: ScoreMotion;
  atmosphere: ScoreAtmosphere;
  relationships: ScoreRelationships;
}
```

The Surface Score lives on the project:

```ts
interface Project {
  tracks: Track[];
  transport: TransportState;
  context: MusicalContext;
  surfaceScore: SurfaceScore;    // AI-generated, human-overridable
  // ...
}
```

---

## How Modules Consume the Score

Each Surface module renders itself using the active Surface Score. Modules do not decide their own colour or motion — they receive derived visual properties from the Score system and apply them to their rendering.

This keeps module authoring simple: a module author implements the control behaviour, and the Score system provides the visual context.

```ts
interface ModuleVisualContext {
  // Derived from track identity + palette
  trackColour: { hue: number; saturation: number; brightness: number };
  glyph: { shape: string; style: string };
  prominence: number;

  // Derived from material mapping + track sonic character
  weight: number;           // 0.0 (featherlight) to 1.0 (heavy)
  edgeStyle: 'crisp' | 'feathered' | 'blur' | 'glow';
  opacity: number;

  // From motion language
  pulseRate: number;        // beats per pulse, 0 = no pulse
  parameterEasing: string;  // CSS easing function or spring config
  idleDrift: number;        // 0.0 (still) to 1.0 (noticeable drift)

  // Ambient relationship data relevant to this track
  relationships: {
    trackId: string;
    type: 'frequency-proximity' | 'rhythmic-alignment' | 'routing';
    intensity: number;
  }[];
}
```

---

## AI Operations

The AI sets and modifies the Surface Score through structured operations. These follow the same pattern as all other AI operations: immediate, undoable, inspectable.

```ts
interface SetSurfaceScoreOp {
  type: 'set_surface_score';
  score: Partial<SurfaceScore>;
  reason: string;    // "Dark, heavy dubstep — deep indigo palette, half-time pulse, heavy materials"
}

interface SetTrackIdentityOp {
  type: 'set_track_identity';
  trackId: string;
  identity: Partial<ScoreTrackIdentity>;
  reason: string;    // "Kick is the rhythmic anchor — heavy circle glyph, deep indigo, high prominence"
}
```

**When the AI sets the Score:**
- When a project is created (initial Score from the first few tracks)
- When the musical character changes significantly
- When explicitly asked ("make the interface feel warmer", "this should feel more aggressive")

**When the AI does NOT change the Score:**
- On every parameter tweak (the mappings handle this automatically — the Score defines the rules, the rendering follows)
- Without being asked, unless the project character has shifted dramatically
- In ways that break readability (brightness floor and contrast rules are hard constraints)

**What the AI cannot do:**
- Generate arbitrary CSS or layout
- Mutate canonical view structure
- Invent uncontrolled components
- Obscure source-of-truth state
- Weaken legibility of editing surfaces

---

## What It Should Feel Like

**Dark dubstep project:** Deep indigo and violet. Heavy, slow-breathing modules. The kick track is dense and solid with a heavy circular glyph; the bass has a gravitational visual pull. Hi-hats are thin, ghostly. The whole Surface pulses at half-tempo. When the AI adds more sub bass, the indigo deepens. When it strips the mix back, colours desaturate and breathing slows. Ember pulse when the AI thinks. Signal propagation when it acts.

**Bright pop sketch:** Warm coral and gold. Light, bouncy motion. Synth chords have a warm glow, drums are crisp and snappy. The Surface feels open and spacious. When the AI adds a filter sweep, you see the colour shift from warm to cool as the filter closes, then back as it opens. Track glyphs are angular and defined.

**Ambient generative piece:** Almost monochrome, soft greys with occasional colour emergence. Very slow drift, nearly still. Modules are translucent, boundaries soft. When a new texture layer fades in, its module materialises gradually — opacity building over several seconds. The Surface feels like it is underwater. Glyphs are amorphous clouds.

**Chaotic noise/industrial project:** High contrast, harsh edges, desaturated with sharp colour spikes. Motion is jagged and percussive. Modules have hard shadows and thick borders. When the AI adds distortion, edges sharpen and shadows deepen. The Surface feels aggressive and dense. Spike-shaped glyphs. Snappy parameter motion.

---

## Success Criteria

This work succeeds if:

- The Surface feels alive and original
- Canonical views remain trustworthy and clear
- Projects develop distinct visual identities
- The AI can shape the Surface within safe bounds
- Users feel the interface is part of the instrument, not just a container around it
- Opening a different project feels like picking up a different instrument
- The visual language communicates musical information the human can feel without consciously interpreting

---

## Open Questions

1. **Performance budget.** Real-time colour derivation, motion sync, and ambient relationships cost GPU/CPU cycles. All visual computations must run on requestAnimationFrame, never on the audio thread, with a complexity budget that degrades gracefully. **Critical constraint:** metabolic motion (LFO breathing, sidechain ducking, tempo-synced pulse) must NOT drive React state — at 140bpm with multiple tracks, React re-renders will choke the DOM and may cause audio glitches. Instead, pass audio-rate/control-rate data from the AudioWorklet directly to CSS custom properties or a lightweight WebGL layer via SharedArrayBuffer. The AI Score defines the animation *rules*; the audio engine drives the animation *frames*.

2. **Accessibility.** Colour vision deficiency: the Score needs an alternative channel (shape via glyphs, luminance variation, or pattern). Motion sensitivity: reduced-motion mode that preserves information through other means. The glyph system helps here — identity is not colour-only.

3. **Human override granularity.** The human should be able to override at the project level ("warmer colours"), the track level ("make the bass red"), or disable the Score entirely (clean default). How deep should per-module overrides go?

4. **Baseline Score.** Before any AI involvement, there should be a handcrafted default Score — a tasteful baseline that feels like Gluon, not like "no theme applied." The AI generates from this baseline rather than from nothing.

5. **When does the AI regenerate?** The Score mappings handle gradual timbral changes automatically. But structural changes (new track, genre shift) may need the AI to regenerate. How often is too often? The Score should evolve, not jump.

6. **Module author burden.** The `ModuleVisualContext` approach pushes most visual work to the rendering system. Module authors apply derived properties — they don't implement the Score system. How much latitude do module authors have to interpret the context creatively vs apply it literally?

---

## Recommended Next Steps

1. Define the first version of the Surface Score schema (the types above are a starting point)
2. Define the minimum AI toolset that can author a Score safely
3. Create one handcrafted baseline Score (the "Gluon default" before AI involvement)
4. Build the `ModuleVisualContext` derivation pipeline (Score + track state -> visual context)
5. Apply the visual context to one Surface module as a prototype (Knob Group is the simplest candidate)

Design the visual language as a system before doing detailed styling. The Score schema comes first.

---

## Design References

**Generative identity systems:**
- MIT Media Lab identity (by Pentagram) — algorithmically generated identities from a base system
- Sagmeister & Walsh — generative design responding to data inputs
- Nervous System (studio) — biological growth algorithms as design tools

**Organic digital interfaces:**
- Brian Eno's Bloom and Scape — generative visuals emerging from musical interaction
- Meadow (game) — natural systems creating ambient, non-demanding visual beauty
- Weather apps (iOS Weather, Windy.com) — fluid gradients and particle systems conveying atmospheric state

**Music-responsive visuals:**
- Lumen (Max Hattler) — audio-reactive visuals with artistic restraint
- TouchDesigner community — audio-reactive visual instruments (technical reference, not aesthetic)

**Materiality and weight in UI:**
- iOS materials system (vibrancy, blur, translucency responding to content)
- Teenage Engineering OP-1 screens — playful, idiosyncratic, handmade-feeling
- Swiss International Style applied to dark interfaces

**What to avoid:**
- Winamp/Milkdrop visualisers (spectacle over meaning)
- Skeuomorphism (fake physical materials)
- Neon cyberpunk (generic "futuristic" music software)
- Over-animation (motion without information is noise)

---

## Relationship to Other Documents

- **View Architecture RFC** (`docs/rfcs/view-architecture.md`) — defines the canonical vs custom view split that creates the space for the Surface Score. The Score applies only to Surface modules.
- **AI-Curated Surfaces RFC** (`docs/rfcs/ai-curated-surfaces.md`) — defines the Surface module composition system. This brief extends it with visual composition alongside control composition.
- **AI Interface Design Principles** (`docs/principles/ai-interface-design-principles.md`) — the Surface Score is a new category of AI affordance. It follows the same rules: structured operations, immediate and undoable, human can override.
- **AI Capability Doctrine** (`docs/principles/ai-capability-doctrine.md`) — visual language generation is capability expansion inside the hard boundaries. It does not affect human authority, undoability, or inspectability.
