# Visual Language Brief

## The Idea

Gluon's Surface view doesn't just compose *controls* — it composes a *visual identity* for the project. The AI designs how the interface looks, moves, and responds based on the music itself. The visual language isn't a theme the human picks from a menu. It emerges from the sound.

This is the visual equivalent of what the AI already does for control surfaces: it reads the musical state, understands the character and intent, and generates an interface that fits. Just as the AI places a step grid for a kick drum and a piano roll for a synth pad, it also gives the kick track visual weight and density, the pad track translucence and drift, and the project as a whole a colour palette that comes from the music's timbral character.

Traditional music software has a fixed visual identity — Ableton is grey, Logic is brushed aluminium, Bitwig is orange. The visuals never respond to what you're making. Gluon's Surface should feel different every time you open a different project, because the visual language is derived from different music.

---

## The Split: Canonical Views vs Surface

The four-view architecture (see `docs/rfcs/view-architecture.md`) creates a natural opportunity for two visual registers:

**Canonical views (Tracker, Rack, Patch)** stay clean, precise, and stable. Dark backgrounds, clear typography, sharp edges, monochrome with functional colour accents. These are the x-ray views — inspection tools where legibility and predictability are paramount. They should feel like good developer tools: dense, honest, no decoration. The visual language here is *absence* — nothing competes with the data.

**Surface** is where the organic, responsive, AI-generated visual language lives. It's the living instrument, not the schematic. Colour, motion, texture, and material all respond to the music. The contrast between the canonical views and the Surface reinforces their different purposes: you switch to the Rack to verify what happened, you switch to the Surface to *play*.

This split means the visual language work described in this brief applies only to the Surface view and its modules. The canonical views have their own, simpler visual design that is not covered here.

---

## What the AI Designs

The AI has a toolkit of visual primitives it can compose into a project-specific visual language. These are not fixed themes or skins — they are generative mappings from musical properties to visual properties. The AI defines the mapping; the visuals emerge from the music in real time.

### 1. Colour Space

The AI defines a colour space for the project — a mapping from musical properties to colour. Each track gets a position in that colour space derived from its timbral character. As the sound changes, the colour follows.

**What the AI defines:**
- A base hue range for the project (derived from the overall timbral character — warm project, cool project, mixed)
- How tracks distribute within that range (by frequency register, by timbral brightness, by role)
- Saturation rules (dense/busy tracks more saturated, sparse tracks more muted)
- A brightness floor (ensures readability — the colours enhance, never obscure)

**How it behaves:**
- A dark, sub-heavy bass track casts a deep indigo wash across its Surface region
- A bright, metallic lead has a warm amber glow
- A noisy, textured percussion track is desaturated, grey-white
- When the AI changes a sound ("make it darker"), the track's colour responds — the human sees the timbral shift before they hear it
- The overall project has a colour palette that emerges from the music, not from a settings menu

**What it's not:**
- Not a fixed palette the human picks (though the human can override)
- Not a spectrogram-as-wallpaper visualiser
- Not neon-on-black (the current look of every "futuristic" music app)

**Colour mapping model:**

```ts
interface ColourMapping {
  // How musical properties map to hue
  hueSource: 'timbral' | 'harmonic' | 'energy' | 'custom';

  // Hue range for the project (degrees, 0-360)
  hueRange: [number, number];

  // How saturation responds to musical density
  saturationRange: [number, number];  // [sparse, dense]

  // Brightness constraints (readability floor)
  brightnessRange: [number, number];  // [minimum, maximum]

  // Per-track overrides (human can pin a track's colour)
  trackOverrides: Record<string, { hue?: number; saturation?: number }>;
}
```

### 2. Motion Language

The AI defines how things move. Motion in the Surface is not decoration — it communicates temporal character. A dubstep project feels different from an ambient project, and the motion language should reflect that.

**What the AI defines:**
- A global pulse character (tempo-synced breathing, energy-driven swell, slow drift, stillness)
- How parameter changes travel (fluid easing, snappy jumps, organic wobble)
- How modulation is displayed (breathing glow, rippling rings, pulsing borders)
- What happens when nothing is being touched (still, gentle drift, slow breathe)

**How it behaves:**
- In a 140bpm dubstep project, the Surface breathes at half-tempo — a slow, heavy swell
- In a sparse ambient project, elements drift almost imperceptibly
- When the AI moves a parameter, the value flows to its new position — the easing curve matches the project's motion character
- A parameter being modulated by an LFO pulses at the LFO's rate — the visual IS the modulation
- A track that's sidechained visually ducks in sync with the compressor
- When the AI is processing a request, the Surface inhales (subtle, system-wide tension). When it responds, it exhales

**What it's not:**
- Not animation for its own sake (every motion carries information)
- Not distracting (motion should be felt peripherally, not watched)
- Not mandatory (the human can reduce or disable motion)

**Motion mapping model:**

```ts
interface MotionMapping {
  // Global pulse behaviour
  pulse: {
    mode: 'tempo-synced' | 'energy-driven' | 'drift' | 'still';
    intensity: number;      // 0.0 (imperceptible) to 1.0 (prominent)
    subdivision: number;    // pulse rate relative to tempo (0.5 = half-time, 1 = quarter note)
  };

  // How parameter values animate to new positions
  parameterMotion: {
    style: 'fluid' | 'snappy' | 'organic' | 'instant';
    durationMs: number;     // base transition duration
  };

  // How active modulation routes are displayed
  modulationDisplay: {
    style: 'breathe' | 'ripple' | 'glow' | 'ring';
    syncToRate: boolean;    // match the modulator's rate
  };

  // Idle behaviour (nothing being touched)
  idle: {
    mode: 'still' | 'drift' | 'breathe';
    intensity: number;
  };

  // AI activity indicator (thinking/acting)
  aiActivity: {
    thinking: 'inhale' | 'shimmer' | 'none';
    acting: 'exhale' | 'ripple' | 'pulse';
  };
}
```

### 3. Material and Weight

The AI gives Surface modules a material quality — visual weight that corresponds to sonic weight. This is the difference between a bass control that feels heavy and dense, and a hi-hat control that feels light and thin.

**What the AI defines:**
- How frequency register maps to visual weight (low = heavy, high = light)
- How pattern density maps to opacity (sparse = translucent, dense = solid)
- Border and shadow treatment (soft/diffuse for pads, sharp for percussive sounds)
- How transient character maps to edge quality (sharp attacks = crisp edges, slow attacks = soft edges)

**How it behaves:**
- A sub bass module has thick borders, deep shadows, and feels planted — visually heavy
- A hi-hat module is thin, almost transparent, with barely-there borders
- A pad with a long attack has soft, feathered edges that seem to blur into the background
- A sharp pluck sound has crisp, well-defined edges
- As the AI changes a sound from soft to aggressive, the module's material responds — edges sharpen, weight increases, shadows deepen

**Material mapping model:**

```ts
interface MaterialMapping {
  // Frequency register → visual weight
  weightFromFrequency: {
    enabled: boolean;
    lowWeight: number;      // 0.0 (featherlight) to 1.0 (heavy)
    highWeight: number;
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

### 4. Ambient Relationships

Cross-track musical relationships become visible as ambient visual effects on the Surface — not explicit wires (that's what the Patch view is for), but felt connections.

**What the AI defines:**
- Whether relationship visualisation is active
- Which relationship types to display (frequency proximity, rhythmic alignment, routing dependencies)
- How relationships are rendered (colour bleed, shared breathing, boundary effects)

**How it behaves:**
- Tracks that are sidechained share a visual pulse — the kick flashes, and the bass visually ducks a beat later
- Tracks in similar frequency ranges have a subtle colour bleed at their borders — a visual warning of potential masking
- Tracks that are rhythmically locked (kick and bass on the same downbeats) breathe together
- When the AI creates a new connection (adds a sidechain), the visual relationship appears on the Surface immediately — before the human switches to Patch to see the explicit wiring

**Relationship display model:**

```ts
interface AmbientRelationships {
  enabled: boolean;

  // Which relationship types to visualise
  frequencyProximity: {
    enabled: boolean;
    style: 'colour-bleed' | 'boundary-glow' | 'none';
    threshold: number;      // how close in frequency before visual effect appears
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

### 5. Responsive Density

The visual richness of the Surface responds to the music's complexity. This is the meta-level: the interface itself breathes with the project's energy.

**How it behaves:**
- A minimal project with two sparse tracks has a clean, open Surface — lots of negative space, muted colours, gentle motion
- A dense project with eight active tracks has a richer Surface — more saturated colours, more visual activity, tighter spacing
- Within a project, if the AI strips a section back ("make it minimal"), the Surface responds — colours desaturate, motion slows, visual weight decreases
- Building up to a drop increases visual intensity — not as a visualiser effect, but as the natural consequence of the colour, motion, and material mappings responding to denser, louder, brighter music

**Responsive density model:**

```ts
interface ResponsiveDensity {
  enabled: boolean;

  // What musical properties drive visual density
  drivers: ('track-count' | 'event-density' | 'parameter-activity' | 'energy')[];

  // How visual properties respond
  saturationResponse: number;    // how much saturation increases with density (0-1)
  motionResponse: number;        // how much motion intensity increases (0-1)
  spacingResponse: number;       // how much spacing tightens (0-1)
}
```

---

## The Combined Type

All five visual primitives compose into a single project-level visual language definition:

```ts
interface ProjectVisualLanguage {
  colour: ColourMapping;
  motion: MotionMapping;
  material: MaterialMapping;
  relationships: AmbientRelationships;
  density: ResponsiveDensity;
}
```

The AI generates a `ProjectVisualLanguage` when a project is created, and updates it as the music evolves. The human can override any part of it — pin a track's colour, disable motion, force a specific material style. Overrides persist; the AI respects them.

This type lives on the project, alongside the musical state:

```ts
interface Project {
  tracks: Track[];
  transport: TransportState;
  context: MusicalContext;
  visualLanguage: ProjectVisualLanguage;  // AI-generated, human-overridable
  // ...
}
```

---

## AI Visual Operations

The AI needs tools to set and modify the visual language. These follow the same pattern as all other AI operations: immediate, undoable, inspectable.

```ts
interface SetVisualLanguageOp {
  type: 'set_visual_language';
  language: Partial<ProjectVisualLanguage>;
  reason: string;    // "Dark, heavy dubstep project — deep indigo palette, half-time pulse"
}
```

The AI sets the visual language:
- When a project is created (initial language from the first few tracks)
- When the musical character changes significantly (the human asks for a dramatically different direction)
- When explicitly asked ("make the interface feel warmer", "I want this to feel more aggressive")

The AI does NOT change the visual language:
- On every parameter tweak (the mappings handle this automatically)
- Without being asked, unless the project character has shifted dramatically
- In ways that break readability (the brightness floor and contrast rules are hard constraints)

---

## How It Connects to Surface Modules

Each Surface module renders itself using the active `ProjectVisualLanguage`. The module doesn't decide its own colour — it reads the colour mapping and derives its appearance from its track's musical properties. This means:

- A Knob Group on a bass track renders with heavy, indigo-tinted visuals
- The same Knob Group type on a hi-hat track renders with light, desaturated visuals
- An XY Pad pulses at the tempo if the motion language says so
- A Step Grid's active steps glow with the track's derived colour
- A Macro Knob's rotation animation uses the project's parameter motion style

Module authors don't need to implement visual language support from scratch. The Surface rendering system provides the derived visual properties (colour, weight, motion parameters) as context. Each module applies them to its own rendering.

```ts
// What a module receives from the visual language system
interface ModuleVisualContext {
  // Derived from the track's musical properties + project colour mapping
  trackColour: { hue: number; saturation: number; brightness: number };

  // Derived from the track's sonic character + material mapping
  weight: number;           // 0.0 (featherlight) to 1.0 (heavy)
  edgeStyle: 'crisp' | 'feathered' | 'blur' | 'glow';
  opacity: number;

  // From the project motion language
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

## What It Should Feel Like

**Opening a dark dubstep project:** Deep indigo and violet. Heavy, slow-breathing modules. The kick track is dense and solid; the bass track has a deep, almost gravitational visual pull. The hi-hats are thin, ghostly, barely visible. The whole Surface pulses at half-tempo. When the AI adds more sub bass, the indigo deepens. When it strips the mix back, the colours desaturate and the breathing slows.

**Opening a bright pop sketch:** Warm coral and gold. Light, bouncy motion. The synth chords have a warm glow, the drums are crisp and snappy. The Surface feels open and spacious. When the AI adds a filter sweep, you see the colour shift from warm to cool as the filter closes, then back as it opens.

**Opening an ambient generative piece:** Almost monochrome, soft greys with occasional colour emergence. Very slow drift, almost still. Modules are translucent, boundaries are soft. When a new texture layer fades in, its module materialises gradually — opacity building over several seconds. The Surface feels like it's underwater.

**Opening a chaotic noise/industrial project:** High contrast, harsh edges, desaturated with sharp colour spikes. Motion is jagged and percussive. Modules have hard shadows and thick borders. The Surface feels aggressive and dense. When the AI adds distortion, the edges get sharper and the shadows deepen.

---

## Design References

**Generative identity systems:**
- MIT Media Lab identity (by Pentagram) — algorithmically generated visual identities from a base system. Each output is unique but recognisably part of the same family
- Sagmeister & Walsh — generative design that responds to data inputs
- Nervous System (studio) — biological growth algorithms as design tools

**Organic digital interfaces:**
- Brian Eno's Bloom and Scape apps — generative visuals that emerge from musical interaction
- Meadow (game) — how natural systems create ambient, non-demanding visual beauty
- Weather apps (iOS Weather, Windy.com) — fluid gradients and particle systems conveying atmospheric state

**Music-responsive visuals:**
- Lumen (by Max Hattler) — real-time audio-reactive visuals with artistic restraint
- TouchDesigner community — audio-reactive visual instruments (reference for technical implementation, not aesthetic)

**Materiality and weight in UI:**
- iOS "materials" system (vibrancy, blur, translucency responding to content)
- Teenage Engineering OP-1 screens — playful, idiosyncratic, handmade-feeling despite being digital
- Swiss International Style applied to dark interfaces — how to be expressive within tight constraints

**What to avoid:**
- Winamp/Milkdrop visualisers (spectacle over meaning)
- Skeuomorphism (fake materials that reference physical objects)
- Neon cyberpunk aesthetic (generic "futuristic" music software)
- Over-animation (motion without information is noise)

---

## Open Questions

1. **Performance budget.** Real-time colour derivation, motion sync, and ambient relationships all cost GPU/CPU cycles. How do we ensure the visual language doesn't compete with the audio engine for resources? Likely answer: all visual computations run on requestAnimationFrame, never on the audio thread, with a complexity budget that degrades gracefully.

2. **Accessibility.** How does the visual language work for users with colour vision deficiency or motion sensitivity? The colour mapping needs an alternative channel (shape, pattern, or luminance variation). Motion must have a reduced-motion mode that preserves information through other means.

3. **Human override granularity.** Can the human override at the project level ("I want warmer colours"), the track level ("make the bass track red"), or the module level ("this knob should be blue")? All three? Where's the right balance between AI expression and human control?

4. **Persistence.** Does the visual language persist with the project save? Almost certainly yes — reopening a project should look the same. But should it adapt if the music has changed since last save?

5. **When does the AI update the visual language?** The mappings handle gradual timbral changes automatically (darker sound → darker colour without AI intervention). But what about structural changes — adding a completely new track, changing genre direction? The AI should probably regenerate the visual language in those cases, but how often is too often?

6. **Module author burden.** How much work is it for a module author (building a new Surface module) to support the visual language? The `ModuleVisualContext` approach pushes most of the work to the rendering system, but modules still need to apply the derived properties meaningfully.

---

## Relationship to Other Documents

- **View Architecture RFC** (`docs/rfcs/view-architecture.md`) — defines the canonical vs custom view split that creates the space for the visual language. The visual language applies only to Surface modules.
- **AI-Curated Surfaces RFC** (`docs/rfcs/ai-curated-surfaces.md`) — defines the Surface module composition system. This brief extends it with visual composition alongside control composition.
- **AI Interface Design Principles** (`docs/principles/ai-interface-design-principles.md`) — the visual language is a new category of AI affordance. It follows the same rules: the AI acts through structured operations, changes are immediate and undoable, the human can override.
- **AI Capability Doctrine** (`docs/principles/ai-capability-doctrine.md`) — visual language generation is a capability expansion inside the hard boundaries. It doesn't affect human authority, undoability, or inspectability.
