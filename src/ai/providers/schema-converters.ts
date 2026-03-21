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

const UNSUPPORTED_KEYS = ['anyOf', 'nullable'] as const;
const STRIPPED_KEYS = ['additionalProperties'] as const;

/**
 * Flatten a `oneOf` into a single Gemini-compatible type.
 * Strategy: if all branches are primitive types, pick `string` (most permissive —
 * numbers and booleans can round-trip through strings). Preserves the original
 * description if present on the parent schema.
 */
function flattenOneOf(branches: JsonSchema[], description: string | undefined, path: string): Schema {
  if (branches.length === 0) {
    throw new Error(`oneOf at ${path} has no branches — invalid schema.`);
  }

  // Collect the unique types from all branches
  const types = new Set(branches.map(b => b.type).filter(Boolean));

  // If every branch is a simple type (no nested objects/arrays), flatten to string
  const hasComplex = branches.some(b => b.type === 'object' || b.type === 'array');
  if (hasComplex) {
    throw new Error(
      `Cannot flatten oneOf with complex types (object/array) at ${path}. ` +
      `Simplify the schema or remove the oneOf.`,
    );
  }

  const result: Schema = { type: Type.STRING as Schema['type'] };

  // If all branches share the same single type, use that type instead
  if (types.size === 1) {
    const only = [...types][0]!;
    const mapped = TYPE_MAP[only];
    if (mapped) result.type = mapped as Schema['type'];
  }

  if (description) result.description = description;

  return result;
}

function convertSchema(schema: JsonSchema, path: string): Schema {
  for (const key of UNSUPPORTED_KEYS) {
    if (schema[key] !== undefined) {
      throw new Error(
        `Unsupported JSON Schema feature "${key}" at ${path}. ` +
        `Gemini's function declaration format does not support this feature.`,
      );
    }
  }

  // Silently strip keys that are harmless validation hints unsupported by Gemini
  for (const key of STRIPPED_KEYS) {
    if (schema[key] !== undefined) {
      const { [key]: _, ...rest } = schema;
      schema = rest as JsonSchema;
    }
  }

  // Handle oneOf by flattening to a single compatible type
  if (schema.oneOf) {
    return flattenOneOf(schema.oneOf, schema.description, path);
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
