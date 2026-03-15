// tests/ai/tool-schemas.test.ts — Tool schema declarations
import { describe, it, expect } from 'vitest';
import { GLUON_TOOLS } from '../../src/ai/tool-schemas';

describe('Tool Schemas', () => {
  it('exports twenty-five tool schemas', () => {
    expect(GLUON_TOOLS).toHaveLength(25);
  });

  it('declares all expected tools', () => {
    const names = GLUON_TOOLS.map(t => t.name);
    expect(names).toContain('move');
    expect(names).toContain('sketch');
    expect(names).toContain('listen');
    expect(names).toContain('set_model');
    expect(names).toContain('set_transport');
    expect(names).toContain('transform');
    expect(names).toContain('add_view');
    expect(names).toContain('remove_view');
    expect(names).toContain('add_processor');
    expect(names).toContain('remove_processor');
    expect(names).toContain('replace_processor');
    expect(names).toContain('add_modulator');
    expect(names).toContain('remove_modulator');
    expect(names).toContain('connect_modulator');
    expect(names).toContain('disconnect_modulator');
    expect(names).toContain('set_surface');
    expect(names).toContain('pin');
    expect(names).toContain('unpin');
    expect(names).toContain('label_axes');
    expect(names).toContain('set_importance');
    expect(names).toContain('mark_approved');
    expect(names).toContain('render');
    expect(names).toContain('spectral');
    expect(names).toContain('dynamics');
    expect(names).toContain('rhythm');
    expect(names).toContain('raise_decision');
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
});
