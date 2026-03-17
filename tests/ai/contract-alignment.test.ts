// tests/ai/contract-alignment.test.ts — Drift-detection test
// Verifies that docs/ai/ai-contract.md stays in sync with the live tool/state interface.
// If this test fails, the contract doc has drifted from the implementation.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GLUON_TOOLS } from '../../src/ai/tool-schemas';

const CONTRACT_PATH = resolve(__dirname, '../../docs/ai/ai-contract.md');
const contractText = readFileSync(CONTRACT_PATH, 'utf-8');

describe('AI Contract alignment with live implementation', () => {
  // ── Tool count ──────────────────────────────────────────────────────────
  it('contract declares correct tool count', () => {
    const match = contractText.match(/The AI has (\w+) tools/);
    expect(match, 'Contract should state tool count').toBeTruthy();
    const wordToNum: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
      eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
      fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
      nineteen: 19, twenty: 20,
    };
    const declared = wordToNum[match![1].toLowerCase()] ?? parseInt(match![1], 10);
    expect(declared).toBe(GLUON_TOOLS.length);
  });

  // ── Every live tool name appears in the contract ────────────────────────
  it('contract documents every live tool', () => {
    const liveNames = GLUON_TOOLS.map(t => t.name);
    for (const name of liveNames) {
      // Match as markdown heading #### `name` or backtick reference `name`
      const pattern = new RegExp('`' + name.replace(/_/g, '_') + '`');
      expect(
        pattern.test(contractText),
        `Tool "${name}" is missing from docs/ai/ai-contract.md`
      ).toBe(true);
    }
  });

  // ── No old/removed tool names linger in the contract ────────────────────
  it('contract does not reference removed tool names', () => {
    const oldToolNames = [
      'add_processor', 'remove_processor', 'replace_processor',
      'add_modulator', 'remove_modulator',
      'connect_modulator', 'disconnect_modulator',
      'add_view', 'remove_view',
    ];
    for (const oldName of oldToolNames) {
      // Match as a heading (#### `old_name`) — backtick references in prose
      // describing what the tool replaces are OK, so we check for heading-level references
      const headingPattern = new RegExp('^####\\s+`' + oldName + '`', 'm');
      expect(
        headingPattern.test(contractText),
        `Removed tool "${oldName}" still has a heading in docs/ai/ai-contract.md`
      ).toBe(false);
    }
  });

  // ── Parameter vocabulary: track source controls ─────────────────────────
  it('contract uses live parameter names for track source controls', () => {
    // The move tool in code lists these as track source controls
    const moveTool = GLUON_TOOLS.find(t => t.name === 'move')!;
    const paramDesc = moveTool.parameters.properties?.param?.description ?? '';

    // Extract track source param names from the tool schema description
    // "For track: "timbre", "harmonics", "morph", "frequency""
    const trackParamMatch = paramDesc.match(/For track:\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/);
    expect(trackParamMatch, 'move tool should list track source params').toBeTruthy();
    const liveTrackParams = [trackParamMatch![1], trackParamMatch![2], trackParamMatch![3], trackParamMatch![4]];

    // Contract must mention each live param name in the Controls section
    for (const param of liveTrackParams) {
      expect(
        contractText.includes(`**${param}**`),
        `Contract should document track source control "${param}"`
      ).toBe(true);
    }

    // Contract must NOT use old semantic names as control names
    const oldSemanticNames = ['brightness', 'richness', 'texture', 'pitch'];
    // Check specifically in the "Track source (Plaits)" table — the first column should use live names
    const sourceSection = contractText.match(/### Track source \(Plaits\)[\s\S]*?(?=###|---)/);
    expect(sourceSection, 'Contract should have Track source section').toBeTruthy();
    for (const oldName of oldSemanticNames) {
      // "brightness" also exists as a Rings control, so only check in the source section
      const inSourceSection = sourceSection![0].includes(`| **${oldName}**`);
      expect(
        inSourceSection,
        `Old semantic name "${oldName}" should not appear as a track source control name in the contract`
      ).toBe(false);
    }
  });

  // ── Modulation targets use live param names ─────────────────────────────
  it('contract uses live param names for modulation targets', () => {
    // The modulation_route tool in code says source targets are: timbre, harmonics, morph
    const routeTool = GLUON_TOOLS.find(t => t.name === 'modulation_route')!;
    const targetDesc = routeTool.parameters.properties?.targetParam?.description ?? '';

    // Should mention timbre, harmonics, morph (not brightness, richness, texture)
    expect(targetDesc).toContain('timbre');
    expect(targetDesc).toContain('harmonics');
    expect(targetDesc).toContain('morph');

    // Contract validation invariants should also use live names
    const invariantsSection = contractText.match(/## Validation Invariants[\s\S]*?(?=---)/);
    expect(invariantsSection).toBeTruthy();
    // Rule 16 should say timbre/harmonics/morph, not brightness/richness/texture
    expect(invariantsSection![0]).toContain('`timbre`');
    expect(invariantsSection![0]).toContain('`harmonics`');
    expect(invariantsSection![0]).toContain('`morph`');
  });

  // ── State format uses live field names ──────────────────────────────────
  it('contract state example uses live param names', () => {
    // The JSON example should use timbre/harmonics/morph/frequency, not brightness/richness/texture/pitch
    const jsonSection = contractText.match(/```json[\s\S]*?```/);
    expect(jsonSection, 'Contract should have JSON state example').toBeTruthy();
    const json = jsonSection![0];

    expect(json).toContain('"timbre"');
    expect(json).toContain('"harmonics"');
    expect(json).toContain('"morph"');
    expect(json).toContain('"frequency"');

    // Should not use old semantic names as track-level source params.
    // "brightness" is a valid Rings control, so we extract the first "params" block
    // (which is the track source params) and check it specifically.
    const firstParams = json.match(/"params":\s*\{([^}]*)\}/);
    expect(firstParams, 'JSON should have a params block').toBeTruthy();
    const trackParams = firstParams![1];
    expect(trackParams).not.toContain('"brightness"');
    expect(trackParams).not.toContain('"richness"');
    expect(trackParams).not.toContain('"texture"');
    expect(trackParams).not.toContain('"pitch"');
  });

  // ── State format includes collaboration fields ──────────────────────────
  it('contract state example includes collaboration state fields', () => {
    const json = contractText.match(/```json[\s\S]*?```/)![0];
    expect(json).toContain('"recent_reactions"');
    expect(json).toContain('"observed_patterns"');
    expect(json).toContain('"restraint_level"');
    expect(json).toContain('"open_decisions"');
  });

  // ── State format includes track-level fields ────────────────────────────
  it('contract state example includes track metadata fields', () => {
    const json = contractText.match(/```json[\s\S]*?```/)![0];
    expect(json).toContain('"approval"');
    expect(json).toContain('"volume"');
    expect(json).toContain('"pan"');
    expect(json).toContain('"importance"');
    expect(json).toContain('"time_signature"');
  });

  // ── Multi-provider architecture ─────────────────────────────────────────
  it('contract describes multi-provider architecture', () => {
    expect(contractText).toContain('multi-provider');
    expect(contractText).not.toMatch(/The AI uses Gemini native function calling/);
  });

  // ── Transport BPM range matches code ────────────────────────────────────
  it('contract transport BPM range matches code', () => {
    const transportTool = GLUON_TOOLS.find(t => t.name === 'set_transport')!;
    const bpmDesc = transportTool.parameters.properties?.bpm?.description ?? '';
    // Extract range from code description
    const codeRange = bpmDesc.match(/\((\d+)-(\d+)\)/);
    expect(codeRange).toBeTruthy();

    // Contract should mention the same range
    // Search the full contract for the BPM range values near set_transport
    const transportIdx = contractText.indexOf('#### `set_transport`');
    expect(transportIdx).toBeGreaterThan(-1);
    // Look at the next 1000 chars after the heading
    const transportSection = contractText.slice(transportIdx, transportIdx + 1000);
    expect(transportSection).toContain(codeRange![1]); // min BPM
    expect(transportSection).toContain(codeRange![2]); // max BPM
  });

  // ── Uses "track" not "voice" for entities ───────────────────────────────
  it('contract uses "track" terminology consistently', () => {
    // Should not use "voice" as the primary entity name (except in processor model names like "fm-voice")
    // Check headings and main prose — "voice" should not appear as a standalone entity reference
    const lines = contractText.split('\n');
    const problematicLines: string[] = [];
    for (const line of lines) {
      // Skip lines that are about fm-voice model name or code examples
      if (line.includes('fm-voice') || line.includes('```')) continue;
      // Flag lines that say "voice" as an entity (e.g., "Target voice ID", "voice agency")
      if (/\bvoice\b/i.test(line) && !/fm-voice|voice pool/i.test(line)) {
        problematicLines.push(line.trim());
      }
    }
    expect(
      problematicLines,
      `Contract still uses "voice" as entity name in ${problematicLines.length} lines. Use "track" instead.`
    ).toEqual([]);
  });
});
