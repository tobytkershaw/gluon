# Hardware Integration Brief

## Why This Matters

Gluon's Surface and Live Controls are designed around physical interaction — knobs you turn, pads you hit, grids you step-program. Right now all of that happens with a mouse on a screen. The gap between "instrument" and "application" is exactly the gap between touching a physical control and clicking a virtual one.

Hardware integration isn't about feature parity with DAWs. It's about making the Surface feel like a real instrument panel. When the AI proposes a macro knob for "Brightness" and you reach for a physical encoder rather than dragging a circle with a mouse, the collaboration becomes embodied. That's the difference between directing an AI and playing with one.

The existing module set is small enough to map completely to a modest hardware setup, but rich enough that the mapping is non-trivial. This is the right time to define the target hardware — before the module set grows further and before Performance mode (#1309–#1312) solidifies its interaction patterns.

## What Needs Physical Controls

Every implemented and in-progress module maps to a specific control type:

| Module | Control Type | Count/Range | Notes |
|--------|-------------|-------------|-------|
| **knob-group** | Rotary encoders | 2–12 per module | Endless encoders with LED ring feedback preferred — reflects 0.0–1.0 normalized value |
| **macro-knob** | Single rotary encoder | 1 per module | Weighted multi-parameter mapping. Ideally touch-sensitive or motorized for value recall when AI changes the underlying value |
| **xy-pad** | 2D continuous surface | 1 per module | Two independent axes. Touchpad, joystick, or per-pad XY sensing |
| **step-grid** | Backlit step buttons | 16 per module | TR-808/909 style — per-step LED state for active/inactive/accent. Currently read-only, will become interactive |
| **pad-grid** | Velocity-sensitive pads | 4×4 = 16 per module | Drum trigger pads with activity indicators. Tap-to-audition framework in place |
| **chain-strip** | Toggle buttons | 1 per processor in chain | Bypass on/off with LED state |
| **Live Controls** | Dynamically remappable | Varies per AI turn | Transient controls that appear and disappear — the hardest mapping problem |
| **Performance mode** (upcoming) | Faders + encoders + XY | TBD | Filter sweep macros, cross-track gestures (#1309–#1312) |

**Total physical control budget for a typical session:**
- 8–24 rotary encoders (knob-groups + macros across tracks)
- 16 velocity-sensitive pads (one pad-grid)
- 16 step buttons with LEDs (one step-grid)
- 4–8 toggle buttons (chain bypass)
- 1 XY control surface
- 0–8 faders (performance mode, mixing)

## Target Hardware

Three manufacturers cover the full control surface with mainstream, class-compliant, widely available products.

### Novation

**Launch Control XL 3** (~$250, released Superbooth 2025)

The primary knob/fader/button controller.

- 24 endless rotary encoders with RGB LED rings
- 8 × 60mm faders
- 16 assignable buttons
- OLED display
- 15 user-defined Custom Modes via Novation Components
- Selectable encoder response curves
- USB-C, class-compliant, 5-pin MIDI I/O

Mapping to Gluon:
- 24 encoders → knob-group modules (up to 12 per bank, two banks), macro-knob instances
- 8 faders → Performance mode sweep macros, track levels
- 16 buttons → chain-strip bypass toggles, transport, mode switching
- Custom Modes → different encoder layouts per Gluon view (Surface vs Rack vs Patch)
- RGB LED rings → reflect current parameter values back to hardware

**Launchpad Pro MK3** (~$250)

The primary pad/grid controller.

- 64 velocity/pressure-sensitive RGB pads (8×8 grid)
- 8 Custom Modes via Novation Components — drag-and-drop widget layout
- Built-in 4-track 32-step polyphonic sequencer
- USB-C, class-compliant, 5-pin MIDI I/O

Mapping to Gluon:
- 8×8 grid partitioned via Custom Modes into:
  - 4×4 zone → pad-grid (drum pads, velocity-sensitive)
  - 1×16 or 2×8 zone → step-grid (sequencer steps with RGB state)
  - Remaining pads → toggle buttons, mode switches, track select
- Pressure sensitivity → could drive macro-knob values or XY-pad axes
- Built-in sequencer → parallel physical sequencing path (human capability parity from a different angle — the hardware has its own sequencer independent of Gluon's)

**Why Novation:**
- Custom Modes are the key differentiator — deep reprogramming without firmware hacking. The 8×8 grid can be zone-partitioned to match whatever module layout the Surface currently shows.
- Same configuration ecosystem (Components) across both controllers.
- Mass-market availability, active development (XL 3 is brand new), large user community.
- 5-pin MIDI I/O on both → ready for future hardware synth integration.

### Arturia

**BeatStep Pro** (~$250)

The dedicated step sequencer controller.

- 16 velocity-sensitive pads with aftertouch
- 16 dedicated step buttons with LEDs (physically separate from pads)
- 16 rotary encoders
- Two 64-step melodic sequencers + one 16-channel drum sequencer
- USB, MIDI, CV/Gate outputs
- MIDI Control Center software for full configuration

Mapping to Gluon:
- 16 step buttons → step-grid module (exact TR-808/909 match — dedicated buttons, not overloaded pads)
- 16 pads → pad-grid module (drum triggers)
- 16 encoders → knob-group module (per-step parameter control or source parameters)
- Built-in sequencer → independent hardware sequencing capability

**Why Arturia:**
- The BeatStep Pro is the only mainstream controller with physically separate step buttons and drum pads. Every other controller (including Launchpad) overloads the pad grid for both functions. For step-sequencer interaction, dedicated step buttons with per-step LEDs are the correct physical affordance.
- CV/Gate outputs open the door to modular synth integration beyond MIDI.

### TouchOSC (Hexler, ~$25)

The dynamic/XY controller on iPad, Android, or phone.

- Fully customizable layouts with drag-and-drop editor
- XY pad widget with configurable ranges
- Lua scripting engine for custom logic
- OSC over UDP/TCP, or MIDI over USB
- Cross-platform (iOS, Android, Windows, macOS, Linux)

Mapping to Gluon:
- XY pad widget → xy-pad module (the only physical XY option that doesn't require a joystick)
- Dynamic layout generation → **Live Controls** (when the AI proposes transient controls, corresponding TouchOSC widgets materialize on the tablet)
- Additional knob/fader/button layouts as overflow for complex sessions
- Lua scripting → the host application can push layout changes to the control surface at runtime

**Why TouchOSC:**
- It's the only option that solves the transient controls problem honestly. Physical hardware has fixed layouts — you can bank-switch encoders, but you can't make a knob appear and disappear. TouchOSC can. When the AI proposes a Live Control, the corresponding widget appears on the tablet screen. When it's dismissed, it disappears.
- The Lua scripting engine means Gluon could drive the control surface layout programmatically, not just receive MIDI from it. This is bidirectional integration.
- At $25 on a phone the user already owns, it's the lowest barrier to entry for any hardware integration.

## Controller Combinations

Different entry points depending on what the user has and what they need:

| Setup | Cost | What It Covers | Gap |
|-------|------|---------------|-----|
| **TouchOSC on phone** | $25 | XY pad, dynamic controls, basic knobs/faders | No tactile feedback, small screen |
| **Launchpad Pro MK3 + TouchOSC** | ~$275 | Pads, step grid, toggles, XY, dynamic controls | Limited rotary encoders (none on Launchpad) |
| **Launch Control XL 3 + Launchpad Pro MK3** | ~$500 | Encoders, faders, buttons, pads, step grid | No XY pad, no dynamic controls |
| **Launch Control XL 3 + BeatStep Pro + TouchOSC** | ~$525 | Encoders, dedicated step buttons, pads, XY, dynamic controls | Pad grid on BeatStep only 16 (fine for 4×4) |
| **Full set: XL 3 + Launchpad Pro + TouchOSC** | ~$525 | Everything | — |

The recommended default target for development is **Launch Control XL 3 + Launchpad Pro MK3 + TouchOSC**. Build controller profiles for these three first.

## Protocol and API Layer

### Web MIDI API

The browser integration point. All three hardware targets are class-compliant USB MIDI devices.

**Browser support (March 2026):**

| Browser | Status |
|---------|--------|
| Chrome | Full support (v43+) — primary target |
| Edge | Full support (v79+, Chromium) |
| Firefox | Supported (v109+), occasional device detection quirks vs Chrome |
| Safari | **Not supported** — Apple declined over fingerprinting concerns |
| iOS Safari | Not supported, no workaround |
| Chrome Android | Supported with USB OTG |

Safari's absence is a significant gap for a browser-based app. No workaround exists beyond a native wrapper (Electron/Tauri) that exposes MIDI directly. This is a known platform limitation, not something Gluon can solve.

**Library:** `webmidi` npm package (v3.1.14) — the standard JavaScript library for Web MIDI. High-level API for note events, control changes, pitch bend, SysEx. Works in browser and Node.js.

### TouchOSC Bridge

TouchOSC speaks OSC (UDP) natively, which browsers cannot receive. Two options:

1. **MIDI mode** — TouchOSC can send MIDI instead of OSC over USB. Works directly with Web MIDI API. Simpler, but loses OSC's human-readable addressing and float resolution.
2. **WebSocket bridge** — a small local server (Node.js or Deno) translates OSC UDP to WebSocket messages for the browser. Preserves OSC's hierarchical addressing (e.g., `/track/1/brightness`), which maps naturally to Gluon's control binding model. More powerful, but requires a local process.

Recommendation: start with MIDI mode for zero-dependency onboarding, add the WebSocket bridge later for bidirectional layout control (pushing layout changes from Gluon to TouchOSC).

### MIDI 2.0

Not targetable yet. The Web MIDI API only handles MIDI 1.0. But worth watching:

- **Property Exchange** (part of MIDI 2.0) will let controllers self-describe their capabilities — number of encoders, pads, fader ranges. This would enable automatic mapping: plug in a controller, Gluon reads its capability profile, generates a default binding layout.
- **32-bit resolution** replaces MIDI 1.0's 7-bit (0–127) values. Gluon already uses 0.0–1.0 floats internally, so the resolution improvement maps directly.
- Windows 11 has native MIDI 2.0 support (Feb 2026). Browser support will follow eventually.

Design the mapping layer with MIDI 2.0 in mind — use float values internally, treat 7-bit CC as a lossy encoding of the underlying float, and the upgrade path is smooth.

## Mapping Architecture

### MIDI Learn

The standard interaction for binding physical controls to virtual ones:

1. User clicks a control on the Surface (or the AI's Live Controls panel)
2. Gluon enters "MIDI Learn" mode for that control
3. User moves a physical knob/hits a pad/presses a button
4. Gluon captures the incoming MIDI message (channel, CC number, or note) and creates a binding
5. Done — the physical control now drives the virtual one

This is the same pattern used by every DAW and plugin. Users expect it.

### Controller Profiles

Pre-built mapping configurations for known hardware:

```typescript
interface ControllerProfile {
  id: string;                    // 'novation-launch-control-xl-3'
  name: string;                  // 'Novation Launch Control XL 3'
  manufacturer: string;

  // How to identify this controller from MIDI port name
  portMatch: RegExp;             // /Launch Control XL/i

  // Default mappings from MIDI events to Gluon control roles
  mappings: ControllerMapping[];

  // LED/display feedback capabilities
  feedback: FeedbackCapability[];
}

interface ControllerMapping {
  // MIDI input
  channel: number;
  type: 'cc' | 'note' | 'pitchbend' | 'aftertouch';
  number: number;                // CC number or note number

  // Gluon target (by role, not by specific control)
  role: string;                  // 'encoder-bank-1', 'pad-row-1', 'step-1', 'fader-1'

  // Value transform
  range: [number, number];       // input range (e.g., [0, 127])
  curve?: 'linear' | 'log' | 'exp';
}
```

Profiles ship with Gluon for the three target controllers. Users can override via MIDI Learn. The profile provides sensible defaults; MIDI Learn provides per-session customization.

### Feedback Loop

Hardware integration is bidirectional. When the AI changes a parameter value (or the value changes from automation/modulation), the physical controller should reflect it:

- **Encoder LED rings** — send CC back to the controller to update the ring position (Launch Control XL 3 supports this)
- **Pad RGB colors** — reflect step-grid state, pad-grid activity, bypass state
- **TouchOSC widgets** — update widget values and even create/destroy widgets dynamically

This is critical for the AI collaboration model. When the AI adjusts "Brightness" from 0.4 to 0.7, the physical encoder's LED ring should move to 0.7. Otherwise the human loses track of the current state.

### Transient Control Mapping (Live Controls)

The hardest problem. Live Controls are AI-proposed and ephemeral — they appear during a conversation turn and may be dismissed or promoted to the permanent Surface.

**Physical hardware (fixed layout):**
- Bank-switching: the same 8 encoders map to different virtual controls depending on the selected bank. The AI proposes controls → they're assigned to bank slots → the user switches to the Live Controls bank to access them.
- OLED display / encoder labels update to show the current binding name.

**TouchOSC (dynamic layout):**
- Gluon pushes a new layout to TouchOSC via the WebSocket bridge when the AI proposes Live Controls.
- Each Live Control becomes a widget on the tablet — knob, slider, or XY pad depending on the control type.
- When the control is dismissed, the widget disappears. When promoted to Surface, the widget stays.

## Implementation Phases

### Phase 1: Web MIDI Input

The minimum viable hardware integration.

- Add `webmidi` dependency
- MIDI device discovery and port listing in the UI
- MIDI Learn mode for Surface knob and macro-knob modules
- CC-to-parameter binding: incoming CC → update the bound parameter's normalized value
- Note-to-pad binding: incoming note-on → trigger the bound pad-grid cell
- No feedback, no profiles, no TouchOSC — just input

**Validates:** that the binding model works, that latency is acceptable, that the interaction feels right.

### Phase 2: Controller Profiles + Feedback

- Ship default profiles for Launch Control XL 3, Launchpad Pro MK3, BeatStep Pro
- Auto-detect connected controllers from MIDI port names
- Apply default mappings on detection (user can override via MIDI Learn)
- Bidirectional feedback: send CC/note messages back to update LED rings, pad colors
- SysEx where needed (Novation controllers use SysEx for RGB pad colors)

**Validates:** that the default experience is good without manual MIDI Learn for every control.

### Phase 3: TouchOSC Bridge

- Local WebSocket-to-OSC bridge (lightweight Node.js/Deno process, or built into a future Electron/Tauri shell)
- Bidirectional: receive control values, send value updates
- Dynamic layout: push layout definitions to TouchOSC when Live Controls change
- Ship a default Gluon layout template for TouchOSC (XY pad + auxiliary knobs + transport)

**Validates:** dynamic control surfaces and the XY pad mapping.

### Phase 4: Step Grid + Pad Grid Input

- Step-grid module becomes interactive (currently read-only) — physical step buttons toggle steps
- Pad-grid tap-to-audition wired to MIDI note input
- Velocity sensitivity flows through to event velocity
- Step LED state reflects pattern state back to hardware

**Validates:** bidirectional sequencer interaction via hardware.

### Phase 5: Performance Mode Hardware

- Map faders and encoders to Performance mode macros (#1309–#1312)
- Cross-track gesture controls via XY pad
- Filter sweep macro via fader or encoder with acceleration curve

**Depends on:** Performance mode implementation completing first.

## Open Questions

1. **Multi-controller arbitration.** If both a physical encoder and the mouse are moving the same parameter simultaneously, who wins? The human-hands-always-win arbitration rule applies, but "human hands" now means two physical inputs. Likely: last-write-wins with a short debounce, same as DAW behavior.

2. **MIDI channel assignment.** With multiple controllers connected, each needs its own MIDI channel or port to avoid collisions. Controller profiles should specify expected channel assignments. Auto-detection from port names handles most cases.

3. **Latency budget.** Web MIDI adds negligible latency (< 1ms). The real latency is in the audio engine responding to parameter changes. This should be measured — if a physical knob turn takes > 10ms to produce an audible change, the instrument feel breaks.

4. **Safari.** No Web MIDI support, no workaround. If Gluon ever ships as a native app (Electron/Tauri), MIDI access comes for free via the native API. Until then, Safari users cannot use hardware controllers.

5. **MIDI vs OSC as primary protocol.** MIDI is the pragmatic choice (Web MIDI API exists, all hardware speaks it). OSC is technically superior (float values, hierarchical addressing, human-readable). The bridge approach — MIDI for hardware, OSC for TouchOSC via bridge — is the right split for now.

6. **Claim system interaction.** When a parameter is claimed (✋), should the physical controller be locked out too? Probably yes — the claim system gates all writes regardless of input source. The physical controller should provide feedback (LED off or different color) when a control is claimed.
