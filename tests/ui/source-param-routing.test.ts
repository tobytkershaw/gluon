import { describe, it, expect, vi } from 'vitest';
import { createSession } from '../../src/engine/session';
import { routeSourceModuleParam } from '../../src/ui/source-param-routing';

describe('routeSourceModuleParam', () => {
  it('routes extended source params to the dedicated handler', () => {
    const session = createSession();
    const handlers = {
      onParamChange: vi.fn(),
      onNoteChange: vi.fn(),
      onHarmonicsChange: vi.fn(),
      onExtendedSourceParamChange: vi.fn(),
    };

    routeSourceModuleParam('lpg-colour', 0.77, session.tracks[0], handlers);

    expect(handlers.onExtendedSourceParamChange).toHaveBeenCalledWith('lpg_colour', 0.77);
    expect(handlers.onParamChange).not.toHaveBeenCalled();
    expect(handlers.onNoteChange).not.toHaveBeenCalled();
    expect(handlers.onHarmonicsChange).not.toHaveBeenCalled();
  });

  it('keeps timbre and morph routed through the paired handler', () => {
    const session = createSession();
    const handlers = {
      onParamChange: vi.fn(),
      onNoteChange: vi.fn(),
      onHarmonicsChange: vi.fn(),
      onExtendedSourceParamChange: vi.fn(),
    };

    routeSourceModuleParam('timbre', 0.25, session.tracks[0], handlers);
    routeSourceModuleParam('morph', 0.75, session.tracks[0], handlers);

    expect(handlers.onParamChange).toHaveBeenNthCalledWith(1, 0.25, 0.5);
    expect(handlers.onParamChange).toHaveBeenNthCalledWith(2, 0.5, 0.75);
  });
});
