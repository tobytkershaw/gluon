import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, GLUON_SYSTEM_PROMPT, extractActiveModules } from '../../src/ai/system-prompt';
import { createSession, addTrack } from '../../src/engine/session';
import { updateTrack } from '../../src/engine/types';
import type { Session, ProcessorConfig, ModulatorConfig } from '../../src/engine/types';

function defaultPrompt(): string {
  return buildSystemPrompt(createSession());
}

/** Create a session with legacy engine assignments for tests that check engine-specific prompt content. */
function createLegacySession(): Session {
  let s = createSession();
  // Default session now starts with 1 track; add 3 more for legacy tests
  s = addTrack(s)!;
  s = addTrack(s)!;
  s = addTrack(s)!;
  s = updateTrack(s, 'v0', { model: 13, engine: 'plaits:analog_bass_drum', name: undefined });
  s = updateTrack(s, 'v1', { model: 0, engine: 'plaits:virtual_analog', name: undefined });
  s = updateTrack(s, 'v2', { model: 2, engine: 'plaits:fm', name: undefined });
  s = updateTrack(s, 'v3', { model: 4, engine: 'plaits:harmonic', name: undefined });
  return s;
}

describe('system prompt generation', () => {
  it('includes all 16 model names', () => {
    const prompt = defaultPrompt();
    const models = [
      'Virtual Analog', 'Waveshaper', 'FM', 'Formant', 'Harmonic',
      'Wavetable', 'Chords', 'Speech', 'Swarm', 'Filtered Noise',
      'Particle Noise', 'Inharmonic String', 'Modal Resonator',
      'Analog Bass Drum', 'Analog Snare Drum', 'Analog Hi-Hat',
    ];
    for (const name of models) {
      expect(prompt).toContain(name);
    }
  });

  it('includes hardware parameter names', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('timbre');
    expect(prompt).toContain('harmonics');
    expect(prompt).toContain('morph');
    expect(prompt).toContain('frequency');
  });

  it('includes parameter ranges', () => {
    const prompt = defaultPrompt();
    expect(prompt).toMatch(/0[.\s]*[-–]\s*1/);
  });

  it('mentions tool-based workflow', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('tools');
    expect(prompt).toContain('tool call');
  });

  it('contains track setup', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('v0');
    expect(prompt).toContain('trigger');
    expect(prompt).toContain('note events');
  });

  it('contains behaviour rules', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('permission');
    expect(prompt).toContain('undo');
  });

  it('describes parity as incomplete and Surface as available', () => {
    const prompt = defaultPrompt();
    expect(prompt).not.toContain('Any control you have over the music, the human has too.');
    expect(prompt).toContain('Human/AI capability parity is a design goal');
    expect(prompt).toContain('Surface (AI-curated controls and modules)');
    expect(prompt).not.toContain('Surface (AI-curated controls — coming soon)');
  });

  it('distinguishes chat labels from tool-call IDs', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('In chat prose, prefer display names');
    expect(prompt).toContain('In tool calls, internal IDs are valid');
    expect(prompt).not.toContain('Refer to tracks by display name ("Track 1", "Kick"), never internal IDs.');
  });

  it('does not contain old JSON action syntax', () => {
    const prompt = defaultPrompt();
    expect(prompt).not.toContain('"type": "move"');
    expect(prompt).not.toContain('Respond with valid JSON');
    expect(prompt).not.toContain('Transport controls (BPM, swing, play/stop) are human-only');
  });

  it('backwards-compatible GLUON_SYSTEM_PROMPT export works', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('v0');
    expect(GLUON_SYSTEM_PROMPT).toContain('How to Work');
  });

  it('guides drum scaffolding to tune pads at creation time and expose kick frequency', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('set musically meaningful initial params as part of creation rather than relying on later repair moves');
    expect(prompt).toContain('especially for kicks, where frequency determines whether it reads as a kick or a tom');
  });
});

describe('dynamic track setup', () => {
  it('shows percussion classification for drum engines', () => {
    const session = createLegacySession();
    const prompt = buildSystemPrompt(session);
    // v0 is model 13 (analog-bass-drum) → percussion
    expect(prompt).toContain('Analog Bass Drum (percussion)');
  });

  it('shows melodic classification for melodic engines', () => {
    const session = createLegacySession();
    const prompt = buildSystemPrompt(session);
    // v1 is model 0 (virtual-analog) → melodic
    expect(prompt).toContain('Virtual Analog (melodic)');
  });

  it('track setup no longer includes agency', () => {
    const session = createLegacySession();
    const prompt = buildSystemPrompt(session);
    expect(prompt).not.toContain('agency ON');
    expect(prompt).not.toContain('agency OFF');
  });

  it('shows correct model name for each track with ordinal labels', () => {
    const session = createLegacySession();
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('Track 1 (Kick) [id: v0]: Analog Bass Drum');
    expect(prompt).toContain('Track 2 (VA) [id: v1]: Virtual Analog');
    expect(prompt).toContain('Track 3 (FM) [id: v2]: FM');
    expect(prompt).toContain('Track 4 (Harmonic) [id: v3]: Harmonic');
  });

  it('mentions transform in capabilities', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('transform');
  });

  it('includes restraint guidance section', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('Restraint:');
  });

  it('includes moderate restraint by default (no reactions)', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('Restraint: Moderate');
  });

  it('includes conservative restraint when reactions are mostly rejections', () => {
    const session = createSession();
    session.reactionHistory = [
      { actionGroupIndex: 0, verdict: 'rejected', timestamp: Date.now() },
      { actionGroupIndex: 1, verdict: 'rejected', timestamp: Date.now() },
      { actionGroupIndex: 2, verdict: 'rejected', timestamp: Date.now() },
    ];
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('Restraint: Conservative');
  });

  it('includes adventurous restraint when reactions are mostly approvals', () => {
    const session = createSession();
    session.reactionHistory = [
      { actionGroupIndex: 0, verdict: 'approved', timestamp: Date.now() },
      { actionGroupIndex: 1, verdict: 'approved', timestamp: Date.now() },
      { actionGroupIndex: 2, verdict: 'approved', timestamp: Date.now() },
    ];
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('Restraint: Adventurous');
  });

  it('mentions observed_patterns and restraint_level in reaction history section', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('observed_patterns');
    expect(prompt).toContain('restraint_level');
  });

  it('includes arrangement thinking guidance', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('## Arrangement Thinking');
    expect(prompt).toContain('Energy arcs and section character');
    expect(prompt).toContain('Phrasing conventions');
    expect(prompt).toContain('manage_sequence');
    expect(prompt).toContain('set_section');
  });

  it('includes chord progression guidance', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('set_chord_progression');
    expect(prompt).toContain('chord_progression');
  });

  it('grounds recovery and final narration in tool evidence', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('Describe only actions confirmed by tool results or resulting state');
    expect(prompt).toContain('Never describe fallback tool calls that do not appear in the tool-call history for the turn');
    expect(prompt).toContain('Treat tool errors and post-execution rejections as real state');
  });
});

describe('dynamic prompt reference (#777)', () => {
  it('always includes all model semantics regardless of active models (#1012)', () => {
    // All models should have detailed semantics so the AI can make good
    // sound design choices when selecting AND configuring a new engine
    const prompt = defaultPrompt();
    // All 16 models should be present with details
    expect(prompt).toMatch(/\*\*0: Virtual Analog\*\*/);
    expect(prompt).toMatch(/\*\*1: Waveshaper\*\*/);
    expect(prompt).toMatch(/\*\*13: Analog Bass Drum\*\*/);
    // Detailed semantics for all models — not just active ones
    expect(prompt).toContain('Detuning between the two waves'); // virtual-analog
    expect(prompt).toContain('Wavefolder amount'); // waveshaping (was previously excluded when inactive)
    expect(prompt).toContain('Attack sharpness'); // analog-bass-drum
    expect(prompt).toContain('Modulation index'); // fm
  });

  it('includes sweet spots only for active models (#1362)', () => {
    // Default session has no active models (model -1), so no sweet spots
    const prompt = defaultPrompt();
    expect(prompt).not.toContain('Dub techno kick:');
    expect(prompt).not.toContain('Clean sub:');

    // With active model 13 (analog bass drum), its sweet spots appear
    let session = createSession();
    session = updateTrack(session, 'v0', { model: 13 });
    const activePrompt = buildSystemPrompt(session);
    expect(activePrompt).toContain('Dub techno kick:'); // analog-bass-drum sweet spot
    // But inactive model sweet spots still omitted
    expect(activePrompt).not.toContain('Clean sub:'); // virtual-analog not active
  });

  it('active model includes frequency and sweet spots (#1362)', () => {
    let session = createSession();
    session = updateTrack(session, 'v0', { model: 13 }); // analog bass drum
    const prompt = buildSystemPrompt(session);
    // Active model gets frequency + sweet spots
    expect(prompt).toContain('Dub techno kick:');
    expect(prompt).toMatch(/13: Analog Bass Drum/);
    expect(prompt).toContain('Attack sharpness'); // harmonics — always present
    expect(prompt).toContain('Fundamental pitch'); // frequency — active only
  });

  it('inactive model omits frequency and sweet spots but keeps core semantics (#1362)', () => {
    // Session with model 13 active; model 0 (virtual-analog) is inactive
    let session = createSession();
    session = updateTrack(session, 'v0', { model: 13 });
    const prompt = buildSystemPrompt(session);
    // virtual-analog core semantics still present
    expect(prompt).toContain('Detuning between the two waves'); // harmonics
    // virtual-analog frequency and sweet spots omitted (not active)
    expect(prompt).not.toContain('Clean sub:'); // virtual-analog sweet spot
  });

  it('drum rack pad model counts as active (#1362)', () => {
    let session = createSession();
    session = updateTrack(session, 'v0', {
      engine: 'drum-rack',
      model: -1,
      drumRack: {
        pads: [
          { id: 'kick', name: 'Kick', source: { engine: 'plaits', model: 13, params: {} }, level: 0.8, pan: 0.0 },
        ],
      },
    });
    const prompt = buildSystemPrompt(session);
    // Model 13 is active via drum rack pad
    expect(prompt).toContain('Dub techno kick:'); // sweet spot for analog bass drum
    expect(prompt).toContain('Fundamental pitch'); // frequency for analog bass drum
  });

  it('always includes compact processor index', () => {
    const prompt = defaultPrompt();
    // Compact index lines for processors should always be present
    expect(prompt).toMatch(/\*\*rings\*\*: Mutable Instruments Rings/);
    expect(prompt).toMatch(/\*\*clouds\*\*: Mutable Instruments Clouds/);
  });

  it('omits detailed processor reference when no processors active', () => {
    const prompt = defaultPrompt();
    expect(prompt).not.toContain('Active Processor Details');
  });

  it('includes detailed processor reference only for active types', () => {
    let session = createSession();
    const ringsProc: ProcessorConfig = { id: 'rings-001', type: 'rings', model: 0, params: {} };
    session = updateTrack(session, 'v0', { processors: [ringsProc] });
    const prompt = buildSystemPrompt(session);
    // Merged format: active types get em-dash detail lines
    expect(prompt).toMatch(/\*\*rings\*\* —/);
    // Rings should have detailed info
    expect(prompt).toContain('Modal Resonator, Sympathetic String');
    // Clouds should NOT have detailed info (not active)
    expect(prompt).not.toContain('Granular, Pitch Shifter');
  });

  it('always includes compact modulator index', () => {
    const prompt = defaultPrompt();
    expect(prompt).toMatch(/\*\*tides\*\*: Mutable Instruments Tides/);
  });

  it('omits detailed modulator reference when no modulators active', () => {
    const prompt = defaultPrompt();
    expect(prompt).not.toContain('Active Modulator Details');
  });

  it('includes detailed modulator reference when modulator is active', () => {
    let session = createSession();
    const tidesMod: ModulatorConfig = { id: 'tides-001', type: 'tides', model: 0, params: {} };
    session = updateTrack(session, 'v0', { modulators: [tidesMod] });
    const prompt = buildSystemPrompt(session);
    // Merged format: active types get em-dash detail lines
    expect(prompt).toMatch(/\*\*tides\*\* —/);
    expect(prompt).toContain('ad (One-shot unipolar attack-decay envelope');
  });

  it('omits active model details when no models are assigned (empty tracks)', () => {
    // Default session has model -1 (no source)
    const prompt = defaultPrompt();
    expect(prompt).not.toContain('Active Model Details');
  });

  it('extractActiveModules returns correct sets', () => {
    let session = createSession();
    session = addTrack(session)!;
    session = updateTrack(session, 'v0', { model: 13 });
    session = updateTrack(session, 'v1', { model: 0 });
    const ringsProc: ProcessorConfig = { id: 'r1', type: 'rings', model: 0, params: {} };
    const tidesMod: ModulatorConfig = { id: 't1', type: 'tides', model: 1, params: {} };
    session = updateTrack(session, 'v0', { processors: [ringsProc], modulators: [tidesMod] });

    const { modelIds, processorTypes, modulatorTypes } = extractActiveModules(session);
    expect(modelIds).toEqual(new Set([13, 0]));
    expect(processorTypes).toEqual(new Set(['rings']));
    expect(modulatorTypes).toEqual(new Set(['tides']));
  });

  it('prompt is shorter with fewer active models vs all models active', () => {
    // Single-track session (1 active model) should be shorter than 4-model session
    const singlePrompt = defaultPrompt();
    const multiSession = createLegacySession();
    const multiPrompt = buildSystemPrompt(multiSession);
    // The multi-model prompt should be longer because it has more active model details
    expect(multiPrompt.length).toBeGreaterThan(singlePrompt.length);
  });
});
