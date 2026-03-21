// src/ui/Tracker.test.ts
import { describe, it, expect } from 'vitest';
import { abbreviatePadName } from './Tracker';

describe('abbreviatePadName', () => {
  it('returns known abbreviations for common drum names', () => {
    expect(abbreviatePadName('Kick')).toBe('KCK');
    expect(abbreviatePadName('Snare')).toBe('SNR');
    expect(abbreviatePadName('Clap')).toBe('CLP');
    expect(abbreviatePadName('Hi-Hat')).toBe('HAT');
    expect(abbreviatePadName('Closed Hat')).toBe('CHH');
    expect(abbreviatePadName('Open Hat')).toBe('OHH');
    expect(abbreviatePadName('Crash')).toBe('CRS');
    expect(abbreviatePadName('Ride')).toBe('RDE');
    expect(abbreviatePadName('Tom')).toBe('TOM');
    expect(abbreviatePadName('Cowbell')).toBe('CWB');
    expect(abbreviatePadName('Shaker')).toBe('SHK');
    expect(abbreviatePadName('Tambourine')).toBe('TMB');
  });

  it('is case-insensitive', () => {
    expect(abbreviatePadName('kick')).toBe('KCK');
    expect(abbreviatePadName('SNARE')).toBe('SNR');
    expect(abbreviatePadName('hi-hat')).toBe('HAT');
  });

  it('trims whitespace', () => {
    expect(abbreviatePadName('  Kick  ')).toBe('KCK');
  });

  it('abbreviates unknown names by stripping vowels and uppercasing', () => {
    // "zither" -> strip vowels from index 1+: "zthr" -> first 3: "ZTH"
    expect(abbreviatePadName('Zither')).toBe('ZTH');
    // "bass" -> strip vowels: "bss" -> "BSS"
    expect(abbreviatePadName('Bass')).toBe('BSS');
  });

  it('handles short names gracefully', () => {
    expect(abbreviatePadName('Hi')).toBe('HI');
    expect(abbreviatePadName('A')).toBe('A');
  });

  it('handles tom variants', () => {
    expect(abbreviatePadName('High Tom')).toBe('HTM');
    expect(abbreviatePadName('Mid Tom')).toBe('MTM');
    expect(abbreviatePadName('Low Tom')).toBe('LTM');
  });
});
