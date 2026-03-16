import { describe, it, expect } from 'vitest';
import type {
  ControlSchema,
  ControlState,
  Region,
  NoteEvent,
  TriggerEvent,
  ParameterEvent,
  MusicalEvent,
  InstrumentDef,
  MoveOp,
  SketchOp,
  SayOp,
  AIOperation,
  ExecutionReport,
} from '../../src/engine/canonical-types';

// Type-level assertion helper
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function assertType<T>(_value: T): void {}

describe('canonical-types', () => {
  describe('ControlSchema', () => {
    it('accepts a valid continuous control', () => {
      const schema: ControlSchema = {
        id: 'timbre',
        name: 'Timbre',
        kind: 'continuous',
        semanticRole: 'brightness',
        description: 'Spectral content',
        readable: true,
        writable: true,
        range: { min: 0, max: 1, default: 0.5 },
        binding: { adapterId: 'plaits-wasm', path: 'params.timbre' },
      };
      expect(schema.id).toBe('timbre');
      expect(schema.semanticRole).toBe('brightness');
    });

    it('accepts null semantic role', () => {
      const schema: ControlSchema = {
        id: 'custom-param',
        name: 'Custom',
        kind: 'continuous',
        semanticRole: null,
        description: 'A custom parameter',
        readable: true,
        writable: true,
        binding: { adapterId: 'test', path: 'custom' },
      };
      expect(schema.semanticRole).toBeNull();
    });
  });

  describe('ControlValue and ControlState', () => {
    it('tracks provenance', () => {
      const state: ControlState = {
        timbre: { value: 0.7, source: 'ai', updatedAt: 1234567890 },
        morph: { value: 0.3, source: 'human' },
        harmonics: { value: 0.5, source: 'default' },
      };
      expect(state.timbre.source).toBe('ai');
      expect(state.morph.source).toBe('human');
    });
  });

  describe('MusicalEvent', () => {
    it('discriminates event kinds', () => {
      const note: NoteEvent = { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 0.25 };
      const trigger: TriggerEvent = { kind: 'trigger', at: 0.5, accent: true };
      const param: ParameterEvent = {
        kind: 'parameter',
        at: 1,
        controlId: 'timbre',
        value: 0.5,
      };

      const events: MusicalEvent[] = [note, trigger, param];
      expect(events).toHaveLength(3);

      // Discriminated union narrowing
      for (const event of events) {
        switch (event.kind) {
          case 'note':
            assertType<number>(event.pitch);
            break;
          case 'trigger':
            assertType<boolean | undefined>(event.accent);
            break;
          case 'parameter':
            assertType<string>(event.controlId);
            break;
        }
      }
    });
  });

  describe('AIOperation', () => {
    it('discriminates operation types', () => {
      const move: MoveOp = {
        type: 'move',
        trackId: 'v0',
        controlId: 'timbre',
        target: { absolute: 0.7 },
      };
      const sketch: SketchOp = {
        type: 'sketch',
        trackId: 'v0',
        mode: 'replace',
        events: [],
        description: 'test',
      };
      const say: SayOp = { type: 'say', text: 'hello' };

      const ops: AIOperation[] = [move, sketch, say];
      expect(ops).toHaveLength(3);
    });
  });

  describe('Region', () => {
    it('accepts a looping pattern region', () => {
      const region: Region = {
        id: 'r1',
        kind: 'pattern',
        start: 0,
        duration: 4,
        loop: true,
        events: [
          { kind: 'trigger', at: 0, accent: true },
          { kind: 'trigger', at: 1 },
        ],
      };
      expect(region.events).toHaveLength(2);
    });
  });

  describe('InstrumentDef', () => {
    it('contains engines with controls', () => {
      const inst: InstrumentDef = {
        type: 'plaits',
        label: 'Mutable Instruments Plaits',
        adapterId: 'plaits-wasm',
        engines: [
          {
            id: 'virtual-analog',
            label: 'Virtual Analog',
            description: 'VA oscillator',
            controls: [
              {
                id: 'timbre',
                name: 'Timbre',
                kind: 'continuous',
                semanticRole: 'brightness',
                description: 'Spectral content',
                readable: true,
                writable: true,
                range: { min: 0, max: 1, default: 0.5 },
                binding: { adapterId: 'plaits-wasm', path: 'params.timbre' },
              },
            ],
          },
        ],
      };
      expect(inst.engines[0].controls).toHaveLength(1);
    });
  });

  describe('ExecutionReport', () => {
    it('has correct shape', () => {
      const report: ExecutionReport = {
        session: {},
        accepted: [{ type: 'say', text: 'done' }],
        rejected: [
          {
            op: { type: 'move', trackId: 'v0', controlId: 'x', target: { absolute: 0 } },
            reason: 'unknown control',
          },
        ],
        log: [{ trackId: 'v0', trackLabel: 'KICK', description: 'test' }],
      };
      expect(report.accepted).toHaveLength(1);
      expect(report.rejected).toHaveLength(1);
    });
  });
});
