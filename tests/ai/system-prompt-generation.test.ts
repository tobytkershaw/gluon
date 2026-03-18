import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, GLUON_SYSTEM_PROMPT, extractActiveModules } from '../../src/ai/system-prompt';
import { createSession, addTrack, setAgency } from '../../src/engine/session';
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
      'Virtual Analog', 'Waveshaping', 'FM', 'Grain/Formant', 'Harmonic',
      'Wavetable', 'Chords', 'Vowel/Speech', 'Swarm', 'Filtered Noise',
      'Particle/Dust', 'Inharmonic String', 'Modal Resonator',
      'Analog Bass Drum', 'Analog Snare', 'Analog Hi-Hat',
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
    expect(prompt).toContain('agency');
    expect(prompt).toContain('undo');
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

  it('reflects agency OFF in prompt', () => {
    let session = createLegacySession();
    session = setAgency(session, 'v1', 'OFF');
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('Track 2 (VA) [id: v1]: Virtual Analog (melodic) — agency OFF');
  });

  it('reflects agency ON in prompt', () => {
    const session = createLegacySession();
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('Track 1 (Kick) [id: v0]: Analog Bass Drum (percussion) — agency ON');
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
});

describe('dynamic prompt reference (#777)', () => {
  it('always includes compact model index with all 16 models', () => {
    // Even a single-track session should list all 16 models in the index
    const prompt = defaultPrompt();
    for (let i = 0; i <= 15; i++) {
      expect(prompt).toMatch(new RegExp(`^${i}: `, 'm'));
    }
  });

  it('only includes detailed semantics for active models', () => {
    // Create a session with a specific model assigned
    let session = createSession();
    session = updateTrack(session, 'v0', { model: 13, engine: 'plaits:analog_bass_drum' });
    const prompt = buildSystemPrompt(session);
    // Active model (13) should have detailed semantics
    expect(prompt).toContain('Active Model Details');
    expect(prompt).toMatch(/\*\*13: Analog Bass Drum\*\*/);
    expect(prompt).toContain('Attack sharpness'); // analog-bass-drum harmonics
    // Inactive model (1 — Waveshaping) should NOT have detailed semantics
    expect(prompt).not.toContain('Wavefolder amount'); // waveshaping timbre
  });

  it('includes detailed semantics for multiple active models', () => {
    const session = createLegacySession();
    const prompt = buildSystemPrompt(session);
    // Models 0, 2, 4, 13 are active
    expect(prompt).toContain('Detuning between the two waves'); // virtual-analog harmonics
    expect(prompt).toContain('Modulation index'); // fm timbre
    expect(prompt).toContain('Index of the most prominent harmonic'); // harmonic timbre
    expect(prompt).toContain('Attack sharpness'); // analog-bass-drum harmonics
    // Model 1 (Waveshaping) is NOT active
    expect(prompt).not.toContain('Wavefolder amount');
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
    expect(prompt).toContain('Active Processor Details');
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
    expect(prompt).toContain('Active Modulator Details');
    expect(prompt).toContain('ad (Attack-decay envelope');
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
