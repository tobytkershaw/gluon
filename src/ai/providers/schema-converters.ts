// src/ai/providers/schema-converters.ts — Convert neutral JSON Schema to provider formats.

import { Type } from '@google/genai';
import type { FunctionDeclaration, Schema } from '@google/genai';
import type { JsonSchema, ToolSchema } from '../types';

const TYPE_MAP: Record<string, string> = {
  object: Type.OBJECT,
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
};

const UNSUPPORTED_KEYS = ['oneOf', 'anyOf', 'additionalProperties', 'nullable'] as const;

function convertSchema(schema: JsonSchema, path: string): Schema {
  for (const key of UNSUPPORTED_KEYS) {
    if (schema[key] !== undefined) {
      throw new Error(
        `Unsupported JSON Schema feature "${key}" at ${path}. ` +
        `Gemini's function declaration format does not support this feature.`,
      );
    }
  }

  const result: Schema = {};

  if (schema.type) {
    const mapped = TYPE_MAP[schema.type];
    if (!mapped) {
      throw new Error(`Unknown JSON Schema type "${schema.type}" at ${path}.`);
    }
    result.type = mapped as Schema['type'];
  }

  if (schema.description) {
    result.description = schema.description;
  }

  if (schema.enum) {
    result.enum = schema.enum as string[];
  }

  if (schema.required) {
    result.required = schema.required;
  }

  if (schema.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = convertSchema(value, `${path}.${key}`);
    }
  }

  if (schema.items) {
    result.items = convertSchema(schema.items, `${path}.items`);
  }

  return result;
}

export function toGeminiDeclarations(tools: ToolSchema[]): FunctionDeclaration[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: convertSchema(tool.parameters, tool.name),
  }));
}

// ---------------------------------------------------------------------------
// OpenAI — JSON Schema passed through directly (no conversion needed).
// ---------------------------------------------------------------------------

export interface OpenAITool {
  type: 'function';
  name: string;
  description: string;
  parameters: JsonSchema;
}

export function toOpenAITools(tools: ToolSchema[]): OpenAITool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
