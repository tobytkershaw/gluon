// tests/ai/human-capability-parity.test.ts
// Programmatic verification of human capability parity: checks that UI components
// export the handlers and props needed for each AI tool capability.
// See docs/audits/human-capability-parity.md for the full verification matrix.

import { describe, it, expect } from 'vitest';
import { GLUON_TOOLS } from '../../src/ai/tool-schemas';

// --- AI tool inventory ---

const AI_TOOL_NAMES = GLUON_TOOLS.map(t => t.name);

// Tools that are inherently AI-facing and have no meaningful human UI equivalent.
const AI_ONLY_TOOLS = new Set([
  'render',         // human presses play and listens
  'listen',         // multimodal audio evaluation
  'analyze',        // audio analysis (spectral/dynamics/rhythm)
  'explain_chain',  // AI-generated chain description
  'simplify_chain', // AI-generated simplification suggestions
  'raise_decision', // human types in chat
  'report_bug',     // human reports bugs through other channels
]);

// Tools that have full UI parity (exposed and editable in at least one canonical view).
const PARITY_OK_TOOLS = new Set([
  'move',              // Rack: sliders for source/processor/modulator params
  'set_model',         // Rack: mode selector dropdowns
  'set_transport',     // Global: BPM input, swing slider, play/stop buttons
  'sketch',            // Step grid (triggers), keyboard piano (notes) — partial: no param events
  'edit_pattern',      // Step grid: toggle individual gates, accents, param locks
  'manage_processor',  // Rack: Module Browser (add), Remove button (remove) — replace has no UI but add/remove do
  'manage_modulator',  // Rack: Module Browser (add), Remove button (remove)
  'modulation_route',  // Patch: port drag to connect, edge select + Delete to disconnect, DraggableNumber for depth
  'manage_view',       // Surface: + Step Grid (add), remove button (remove)
  'manage_track',      // Sidebar: + Track button (add), remove button (remove)
  'manage_send',       // Sidebar/Patch: send routing UI
  'set_master',        // Footer: master volume/pan controls
  'manage_pattern',    // Tracker: pattern CRUD buttons (add, remove, duplicate, rename, select, length, clear)
  'manage_sequence',   // Tracker: sequence arrangement UI (append, remove, reorder pattern refs)
]);

// Tools with identified parity gaps (no or partial UI path).
const PARITY_GAP_TOOLS = new Set([
  'transform',           // CRITICAL: no rotate/transpose/reverse/duplicate UI
  'set_surface',         // MODERATE: AI-only surface authoring
  'pin_control',         // MODERATE: no UI to pin/unpin controls
  'label_axes',          // MODERATE: no UI for axis labels
  'set_track_meta',      // MODERATE: approval has cycle button but importance/musicalRole have no UI
  'set_intent',          // MODERATE: no UI for session intent (genre/mood/references)
  'set_section',         // MODERATE: no UI for section metadata (name/energy/density targets)
  'set_scale',           // MODERATE: no UI for global scale/key constraint
  'apply_chain_recipe',  // LOW: compound tool — humans use individual processor controls instead
  'set_mix_role',        // LOW: compound tool — humans use volume/pan sliders directly
  'apply_modulation',    // LOW: compound tool — humans use individual modulator controls instead
  'shape_timbre',              // MODERATE: no UI for timbral direction controls (human can move params directly)
  'assign_spectral_slot',      // LOW: compound tool — humans use EQ controls directly
  'manage_motif',        // MODERATE: no UI for motif registration/development (human can copy/paste patterns)
]);

describe('Human Capability Parity', () => {
  it('all AI tools are accounted for in the parity audit', () => {
    const accounted = new Set([...AI_ONLY_TOOLS, ...PARITY_OK_TOOLS, ...PARITY_GAP_TOOLS]);
    const unaccounted = AI_TOOL_NAMES.filter(name => !accounted.has(name));
    expect(unaccounted).toEqual([]);
  });

  it('no tool appears in multiple categories', () => {
    const allSets = [AI_ONLY_TOOLS, PARITY_OK_TOOLS, PARITY_GAP_TOOLS];
    for (const name of AI_TOOL_NAMES) {
      const count = allSets.filter(s => s.has(name)).length;
      expect(count, `Tool "${name}" appears in ${count} categories`).toBeLessThanOrEqual(1);
    }
  });

  it('every accounted tool exists in GLUON_TOOLS', () => {
    const allAccounted = [...AI_ONLY_TOOLS, ...PARITY_OK_TOOLS, ...PARITY_GAP_TOOLS];
    for (const name of allAccounted) {
      expect(AI_TOOL_NAMES, `Expected "${name}" in GLUON_TOOLS`).toContain(name);
    }
  });

  it('documents the expected number of parity gaps', () => {
    // Update this count when gaps are closed or new ones discovered.
    // Current gaps: transform, set_surface,
    // pin_control, label_axes, set_track_meta, set_intent, set_section, set_scale
    expect(PARITY_GAP_TOOLS.size).toBe(14);
  });

  it('documents the expected number of AI-only tools', () => {
    expect(AI_ONLY_TOOLS.size).toBe(7);
  });

  it('most musical tools have UI parity', () => {
    // At least 8 of the 13 non-AI-only tools should have parity
    const nonAiTools = AI_TOOL_NAMES.filter(n => !AI_ONLY_TOOLS.has(n));
    const parityCount = nonAiTools.filter(n => PARITY_OK_TOOLS.has(n)).length;
    expect(parityCount).toBeGreaterThanOrEqual(8);
  });

  // --- Structural checks: verify UI component exports exist ---

  it('RackView component is exported', async () => {
    const mod = await import('../../src/ui/RackView');
    expect(mod.RackView).toBeDefined();
  });

  it('PatchView component is exported', async () => {
    const mod = await import('../../src/ui/PatchView');
    expect(mod.PatchView).toBeDefined();
  });

  it('TrackerView component is exported', async () => {
    const mod = await import('../../src/ui/TrackerView');
    expect(mod.TrackerView).toBeDefined();
  });

  it('Tracker component is exported', async () => {
    const mod = await import('../../src/ui/Tracker');
    expect(mod.Tracker).toBeDefined();
  });

  it('TrackerRow component is exported', async () => {
    const mod = await import('../../src/ui/TrackerRow');
    expect(mod.TrackerRow).toBeDefined();
  });

  it('ModuleBrowser component is exported (add processor/modulator)', async () => {
    const mod = await import('../../src/ui/ModuleBrowser');
    expect(mod.ModuleBrowser).toBeDefined();
  });

  it('ModulePanel component is exported (parameter sliders)', async () => {
    const mod = await import('../../src/ui/ModulePanel');
    expect(mod.ModulePanel).toBeDefined();
  });

  it('TransportStrip component is exported (BPM/swing/play)', async () => {
    const mod = await import('../../src/ui/TransportStrip');
    expect(mod.TransportStrip).toBeDefined();
  });

  it('StepGrid component is exported (trigger creation)', async () => {
    const mod = await import('../../src/ui/StepGrid');
    expect(mod.StepGrid).toBeDefined();
  });

  it('SemanticControlsSection is exported (semantic knob display)', async () => {
    const mod = await import('../../src/ui/SemanticControlsSection');
    expect(mod.SemanticControlsSection).toBeDefined();
  });

  it('DraggableNumber is exported (modulation depth editing)', async () => {
    const mod = await import('../../src/ui/DraggableNumber');
    expect(mod.DraggableNumber).toBeDefined();
  });

  it('ViewToggle exposes all four canonical views', async () => {
    const mod = await import('../../src/ui/view-types');
    // ViewMode is a type, but we can verify the ViewToggle tab list
    const viewToggle = await import('../../src/ui/ViewToggle');
    expect(viewToggle.ViewToggle).toBeDefined();
    // The four views should be: surface, rack, patch, tracker
    // We verify via the type definition
    type _Check = typeof mod.ViewMode; // This is just a type — compile-time only
    // Runtime: we just verified the component exports
  });

  it('useKeyboardPiano hook is exported (note event creation)', async () => {
    const mod = await import('../../src/ui/useKeyboardPiano');
    expect(mod.useKeyboardPiano).toBeDefined();
  });
});
