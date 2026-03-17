// tests/ai/providers/schema-converters.test.ts
import { describe, it, expect } from 'vitest';
import { toGeminiDeclarations, toOpenAITools } from '../../../src/ai/providers/schema-converters';
import { GLUON_TOOLS } from '../../../src/ai/tool-schemas';
import type { ToolSchema } from '../../../src/ai/types';
import { Type } from '@google/genai';

describe('toGeminiDeclarations', () => {
  it('converts all 26 tools without error', () => {
    const declarations = toGeminiDeclarations(GLUON_TOOLS);
    expect(declarations).toHaveLength(26);
  });

  it('preserves tool names and descriptions', () => {
    const declarations = toGeminiDeclarations(GLUON_TOOLS);
    for (let i = 0; i < GLUON_TOOLS.length; i++) {
      expect(declarations[i].name).toBe(GLUON_TOOLS[i].name);
      expect(declarations[i].description).toBe(GLUON_TOOLS[i].description);
    }
  });

  it('maps type strings to Gemini Type enum', () => {
    const tools: ToolSchema[] = [{
      name: 'test',
      description: 'test tool',
      parameters: {
        type: 'object',
        properties: {
          s: { type: 'string' },
          n: { type: 'number' },
          i: { type: 'integer' },
          b: { type: 'boolean' },
          a: { type: 'array', items: { type: 'string' } },
        },
      },
    }];

    const [decl] = toGeminiDeclarations(tools);
    const props = decl.parameters!.properties!;
    expect(props.s.type).toBe(Type.STRING);
    expect(props.n.type).toBe(Type.NUMBER);
    expect(props.i.type).toBe(Type.INTEGER);
    expect(props.b.type).toBe(Type.BOOLEAN);
    expect(props.a.type).toBe(Type.ARRAY);
  });

  it('preserves required arrays', () => {
    const [moveDecl] = toGeminiDeclarations(GLUON_TOOLS.filter(t => t.name === 'move'));
    expect(moveDecl.parameters!.required).toEqual(['param', 'target']);
  });

  it('converts nested objects correctly (move target)', () => {
    const [moveDecl] = toGeminiDeclarations(GLUON_TOOLS.filter(t => t.name === 'move'));
    const targetProp = moveDecl.parameters!.properties!.target;
    expect(targetProp.type).toBe(Type.OBJECT);
    expect(targetProp.properties!.absolute.type).toBe(Type.NUMBER);
    expect(targetProp.properties!.relative.type).toBe(Type.NUMBER);
  });

  it('converts array items correctly (sketch events)', () => {
    const [sketchDecl] = toGeminiDeclarations(GLUON_TOOLS.filter(t => t.name === 'sketch'));
    const eventsProp = sketchDecl.parameters!.properties!.events;
    expect(eventsProp.type).toBe(Type.ARRAY);
    expect(eventsProp.items!.type).toBe(Type.OBJECT);
    expect(eventsProp.items!.properties!.kind.type).toBe(Type.STRING);
    expect(eventsProp.items!.properties!.at.type).toBe(Type.INTEGER);
    expect(eventsProp.items!.required).toEqual(['kind', 'at']);
  });

  it('converts deeply nested objects (set_surface semantic controls)', () => {
    const [surfaceDecl] = toGeminiDeclarations(GLUON_TOOLS.filter(t => t.name === 'set_surface'));
    const scProp = surfaceDecl.parameters!.properties!.semanticControls;
    expect(scProp.type).toBe(Type.ARRAY);
    const itemProps = scProp.items!.properties!;
    expect(itemProps.weights.type).toBe(Type.ARRAY);
    expect(itemProps.weights.items!.properties!.moduleId.type).toBe(Type.STRING);
  });

  it('throws for oneOf', () => {
    const tools: ToolSchema[] = [{
      name: 'bad',
      description: 'bad tool',
      parameters: {
        type: 'object',
        properties: {
          x: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        },
      },
    }];

    expect(() => toGeminiDeclarations(tools)).toThrow(/oneOf.*bad\.x/);
  });

  it('throws for anyOf', () => {
    const tools: ToolSchema[] = [{
      name: 'bad',
      description: 'bad tool',
      parameters: {
        type: 'object',
        properties: {
          x: { anyOf: [{ type: 'string' }] },
        },
      },
    }];

    expect(() => toGeminiDeclarations(tools)).toThrow(/anyOf.*bad\.x/);
  });

  it('throws for additionalProperties', () => {
    const tools: ToolSchema[] = [{
      name: 'bad',
      description: 'bad tool',
      parameters: {
        type: 'object',
        additionalProperties: true,
      },
    }];

    expect(() => toGeminiDeclarations(tools)).toThrow(/additionalProperties/);
  });

  it('throws for unknown type', () => {
    const tools: ToolSchema[] = [{
      name: 'bad',
      description: 'bad tool',
      parameters: { type: 'map' },
    }];

    expect(() => toGeminiDeclarations(tools)).toThrow(/Unknown JSON Schema type "map"/);
  });

  it('handles enum values', () => {
    const tools: ToolSchema[] = [{
      name: 'test',
      description: 'test',
      parameters: {
        type: 'object',
        properties: {
          color: { type: 'string', enum: ['red', 'green', 'blue'] },
        },
      },
    }];

    const [decl] = toGeminiDeclarations(tools);
    expect(decl.parameters!.properties!.color.enum).toEqual(['red', 'green', 'blue']);
  });

  it('preserves descriptions on nested properties', () => {
    const [moveDecl] = toGeminiDeclarations(GLUON_TOOLS.filter(t => t.name === 'move'));
    const paramProp = moveDecl.parameters!.properties!.param;
    expect(paramProp.description).toBeTruthy();
  });
});

describe('toOpenAITools', () => {
  it('converts all 26 tools', () => {
    const tools = toOpenAITools(GLUON_TOOLS);
    expect(tools).toHaveLength(26);
  });

  it('produces correct envelope format', () => {
    const tools = toOpenAITools(GLUON_TOOLS);
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    }
  });

  it('preserves tool names and descriptions', () => {
    const tools = toOpenAITools(GLUON_TOOLS);
    for (let i = 0; i < GLUON_TOOLS.length; i++) {
      expect(tools[i].name).toBe(GLUON_TOOLS[i].name);
      expect(tools[i].description).toBe(GLUON_TOOLS[i].description);
    }
  });

  it('passes JSON Schema through without conversion', () => {
    const tools = toOpenAITools(GLUON_TOOLS);
    const moveTool = tools.find(t => t.name === 'move')!;
    // Parameters should be the exact same object reference — no conversion
    const original = GLUON_TOOLS.find(t => t.name === 'move')!;
    expect(moveTool.parameters).toBe(original.parameters);
  });
});
