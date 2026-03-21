// src/engine/mix-roles.ts — Mix role presets for common track types.

export interface MixRole {
  name: string;
  description: string;
  defaults: {
    volume: number;   // 0-1 normalized
    pan: number;      // -1.0 (left) to 1.0 (right), 0.0 = center
  };
}

const ROLES: Record<string, MixRole> = {
  lead: {
    name: 'lead',
    description: 'Lead voice — prominent, centered, dry',
    defaults: { volume: 0.85, pan: 0.0 },
  },
  pad: {
    name: 'pad',
    description: 'Pad/texture — quieter, wide stereo',
    defaults: { volume: 0.6, pan: 0.0 },
  },
  rhythm_foundation: {
    name: 'rhythm_foundation',
    description: 'Kick/main rhythm — loud, centered',
    defaults: { volume: 0.9, pan: 0.0 },
  },
  sub: {
    name: 'sub',
    description: 'Sub bass — centered, controlled level',
    defaults: { volume: 0.75, pan: 0.0 },
  },
  texture: {
    name: 'texture',
    description: 'Background texture — quiet, ambient',
    defaults: { volume: 0.45, pan: 0.0 },
  },
  accent: {
    name: 'accent',
    description: 'Accent/fill — moderate level, slightly off-center',
    defaults: { volume: 0.65, pan: -0.1 },
  },
};

/** All known role names. */
export const ROLE_NAMES = Object.keys(ROLES);

/** Get a mix role by name, or undefined if not found. */
export function getMixRole(name: string): MixRole | undefined {
  return ROLES[name];
}

/** List all available mix roles (name, description). */
export function getMixRoleList(): { name: string; description: string }[] {
  return Object.values(ROLES).map(r => ({
    name: r.name,
    description: r.description,
  }));
}
