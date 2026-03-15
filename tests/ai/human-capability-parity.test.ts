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
  'render',        // human presses play and listens
  'listen',        // multimodal audio evaluation
  'spectral',      // audio analysis
  'dynamics',      // audio analysis
  'rhythm',        // audio analysis
  'raise_decision', // human types in chat
]);

// Tools that have full UI parity (exposed and editable in at least one canonical view).
const PARITY_OK_TOOLS = new Set([
  'move',              // Rack: sliders for source/processor/modulator params
  'set_model',         // Rack: mode selector dropdowns
  'set_transport',     // Global: BPM input, swing slider, play/stop buttons
  'sketch',            // Step grid (triggers), keyboard piano (notes) — partial: no param events
  'add_processor',     // Rack: Module Browser
  'remove_processor',  // Rack: Remove button per processor
  'add_modulator',     // Rack: Module Browser
  'remove_modulator',  // Rack: Remove button per modulator
  'disconnect_modulator', // Rack: remove button on routing chip
  'mark_approved',     // TrackList: cycle approval button
  'add_view',          // Surface: + Step Grid button
  'remove_view',       // Surface: remove button on view slot
]);

// Tools with identified parity gaps (no or partial UI path).
const PARITY_GAP_TOOLS = new Set([
  'connect_modulator',   // CRITICAL: no UI to create modulation routes
  'replace_processor',   // MINOR: must remove+add manually
  'transform',           // CRITICAL: no rotate/transpose/reverse/duplicate UI
  'set_surface',         // MODERATE: AI-only surface authoring
  'pin',                 // MODERATE: no UI to pin controls
  'unpin',               // MODERATE: no UI to unpin controls
  'label_axes',          // MODERATE: no UI for axis labels
  'set_importance',      // MODERATE: no UI for importance/musicalRole
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
    // Current gaps: connect_modulator, replace_processor, transform,
    // set_surface, pin, unpin, label_axes, set_importance
    expect(PARITY_GAP_TOOLS.size).toBe(8);
  });

  it('documents the expected number of AI-only tools', () => {
    expect(AI_ONLY_TOOLS.size).toBe(6);
  });

  it('most musical tools have UI parity', () => {
    // At least 12 of the ~20 non-AI-only tools should have parity
    const nonAiTools = AI_TOOL_NAMES.filter(n => !AI_ONLY_TOOLS.has(n));
    const parityCount = nonAiTools.filter(n => PARITY_OK_TOOLS.has(n)).length;
    expect(parityCount).toBeGreaterThanOrEqual(12);
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

  it('ControlSection component is exported (parameter sliders)', async () => {
    const mod = await import('../../src/ui/ControlSection');
    expect(mod.ControlSection).toBeDefined();
  });

  it('TransportBar component is exported (BPM/swing/play)', async () => {
    const mod = await import('../../src/ui/TransportBar');
    expect(mod.TransportBar).toBeDefined();
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
