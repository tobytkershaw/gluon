// tests/ai/tool-schemas.test.ts — Tool schema declarations
import { describe, it, expect } from 'vitest';
import { GLUON_TOOLS, REGISTRY_CONTROL_IDS } from '../../src/ai/tool-schemas';

describe('Tool Schemas', () => {
  it('exports eighteen tool schemas', () => {
    expect(GLUON_TOOLS).toHaveLength(18);
  });

  it('declares all expected tools', () => {
    const names = GLUON_TOOLS.map(t => t.name);
    expect(names).toContain('move');
    expect(names).toContain('sketch');
    expect(names).toContain('listen');
    expect(names).toContain('set_model');
    expect(names).toContain('set_transport');
    expect(names).toContain('transform');
    expect(names).toContain('manage_view');
    expect(names).toContain('manage_processor');
    expect(names).toContain('manage_modulator');
    expect(names).toContain('modulation_route');
    expect(names).toContain('set_surface');
    expect(names).toContain('pin_control');
    expect(names).toContain('label_axes');
    expect(names).toContain('set_track_meta');
    expect(names).toContain('render');
    expect(names).toContain('analyze');
    expect(names).toContain('raise_decision');
    expect(names).toContain('report_bug');
  });

  it('does not contain old tool names', () => {
    const names = GLUON_TOOLS.map(t => t.name);
    expect(names).not.toContain('add_view');
    expect(names).not.toContain('remove_view');
    expect(names).not.toContain('add_processor');
    expect(names).not.toContain('remove_processor');
    expect(names).not.toContain('replace_processor');
    expect(names).not.toContain('add_modulator');
    expect(names).not.toContain('remove_modulator');
    expect(names).not.toContain('connect_modulator');
    expect(names).not.toContain('disconnect_modulator');
    expect(names).not.toContain('pin');
    expect(names).not.toContain('unpin');
    expect(names).not.toContain('set_importance');
    expect(names).not.toContain('mark_approved');
    expect(names).not.toContain('spectral');
    expect(names).not.toContain('dynamics');
    expect(names).not.toContain('rhythm');
  });

  it('all tools have description and name', () => {
    for (const tool of GLUON_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it('all tools have object type parameters', () => {
    for (const tool of GLUON_TOOLS) {
      expect(tool.parameters.type).toBe('object');
    }
  });

  it('move tool requires param and target', () => {
    const move = GLUON_TOOLS.find(t => t.name === 'move')!;
    expect(move.parameters.required).toEqual(['param', 'target']);
  });

  it('sketch tool requires trackId, description, events', () => {
    const sketch = GLUON_TOOLS.find(t => t.name === 'sketch')!;
    expect(sketch.parameters.required).toEqual(['trackId', 'description', 'events']);
  });

  it('listen tool requires question', () => {
    const listen = GLUON_TOOLS.find(t => t.name === 'listen')!;
    expect(listen.parameters.required).toEqual(['question']);
  });

  it('set_transport tool has no required params', () => {
    const transport = GLUON_TOOLS.find(t => t.name === 'set_transport')!;
    expect(transport.parameters.required).toBeUndefined();
  });

  it('move param description includes all registry control IDs', () => {
    const move = GLUON_TOOLS.find(t => t.name === 'move')!;
    const desc = move.parameters.properties?.param?.description ?? '';
    for (const [instrument, ids] of Object.entries(REGISTRY_CONTROL_IDS)) {
      for (const id of ids) {
        expect(desc, `move param description missing ${instrument} control "${id}"`).toContain(`"${id}"`);
      }
    }
  });

  it('modulation_route targetParam description includes all registry control IDs for source and processors', () => {
    const route = GLUON_TOOLS.find(t => t.name === 'modulation_route')!;
    const desc = route.parameters.properties?.targetParam?.description ?? '';
    for (const id of REGISTRY_CONTROL_IDS.plaits) {
      expect(desc, `targetParam description missing Plaits control "${id}"`).toContain(`"${id}"`);
    }
    for (const id of REGISTRY_CONTROL_IDS.rings) {
      expect(desc, `targetParam description missing Rings control "${id}"`).toContain(`"${id}"`);
    }
    for (const id of REGISTRY_CONTROL_IDS.clouds) {
      expect(desc, `targetParam description missing Clouds control "${id}"`).toContain(`"${id}"`);
    }
  });

  it('merged tools have action parameter with enum', () => {
    const mergedTools = ['manage_processor', 'manage_modulator', 'modulation_route', 'manage_view', 'pin_control'];
    for (const name of mergedTools) {
      const tool = GLUON_TOOLS.find(t => t.name === name)!;
      const actionProp = tool.parameters.properties?.action;
      expect(actionProp, `${name} should have action property`).toBeDefined();
      expect(actionProp?.enum, `${name} action should have enum`).toBeDefined();
    }
  });

  it('analyze tool requires snapshotId and types', () => {
    const analyze = GLUON_TOOLS.find(t => t.name === 'analyze')!;
    expect(analyze.parameters.required).toEqual(['snapshotId', 'types']);
  });

  it('set_track_meta tool requires only trackId', () => {
    const meta = GLUON_TOOLS.find(t => t.name === 'set_track_meta')!;
    expect(meta.parameters.required).toEqual(['trackId']);
  });
});
