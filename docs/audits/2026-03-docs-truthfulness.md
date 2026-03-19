# Docs Truthfulness Audit — 2026-03-19

Audit of roadmap, architecture docs, and protocol spec against the shipped codebase.

---

## Summary

| Category | Count |
|----------|-------|
| Overclaims (says shipped, isn't) | 5 |
| Underclaims (shipped, not reflected) | 8 |
| Stale status markers | 4 |
| Superseded contracts | 2 |
| Ambiguous / needs precision | 6 |

---

## 1. Overclaims — Docs Say It's There, It Isn't

### 1.1 Braids synthesis engine

**Where:** `docs/gluon-architecture.md` lines 101–103 list Braids as an available module with 33 synthesis models.

**Reality:** Braids has no source files anywhere in `src/`. It was never compiled to WASM or registered. Only Plaits is a source engine.

**Fix:** Architecture doc updated to mark Braids as future/aspirational.

### 1.2 MIDI/OSC bridge described as existing infrastructure

**Where:** `docs/gluon-architecture.md` section 5 (lines 180–231) describes MIDI output, MIDI input, OSC, Ableton integration, and hardware profiles as current architecture components, not future.

**Reality:** No MIDI or OSC bridge exists in `src/`. MIDI pitch values are used internally for note representation, but there is no MIDI I/O, no hardware profile system, no OSC support. These are M7 territory.

**Fix:** Architecture doc updated to clarify this is future/M7.

### 1.3 "20-tool AI collaboration layer"

**Where:** `docs/roadmap.md` line 9.

**Reality:** The tool schema file (`src/ai/tool-schemas.ts`) defines **41 tools**, not 20. The 20-tool count dates from M6A consolidation (PR #366) and has not been updated since the AI capability sprint added ~21 more tools.

**Fix:** Roadmap updated to say "40+ tool".

### 1.4 Permission-request flow for agency-blocked actions

**Where:** `docs/gluon-interaction-protocol-v05.md` lines 134–136 describe a permission-request mechanism where blocked actions return `{ blocked: true, reason: "agency_off", decisionId }` and the AI waits for approval.

**Reality:** No such permission-request flow exists in `src/engine/operation-executor.ts`. Agency OFF simply blocks the action. The `raise_decision` tool exists but is not wired into agency gating.

**Status:** Ambiguous — this may be intended for the #926 agency redesign. Noted in protocol doc but not fixed, since the protocol is a draft spec.

### 1.5 Architecture doc Development Milestones — stale status markers

**Where:** `docs/gluon-architecture.md` lines 340–348.

**Reality:** M0 (second instance) is listed as "IN PROGRESS", M5 as "PLANNED", M6 as "PLANNED". All three are complete. The architecture doc's milestone section has not been updated since before M5 shipped.

**Fix:** Architecture doc updated to mark M0/M5/M6 as COMPLETE and add Finalization as current.

---

## 2. Underclaims — Shipped But Not Reflected in Docs

### 2.1 Elements, Warps, Beads, Chorus, Distortion, Stereo modules

**Where:** `docs/roadmap.md` line 9 lists only "Plaits/Rings/Clouds/Tides synthesis, processor chains (Ripples, EQ, Compressor)".

**Reality:** The instrument registry also includes Elements, Warps, Beads, Chorus, Distortion, and Stereo — 11 processor/source modules total, not 7.

**Fix:** Roadmap updated to list all shipped modules.

### 2.2 Architecture doc lists only Rings, Clouds as "Additional MI modules"

**Where:** `docs/gluon-architecture.md` lines 104–109 lists Rings, Clouds, Elements, Tides, Warps as additional MI modules with the framing "These would be compiled to WebAssembly." Elements and Warps are already compiled and registered.

**Fix:** Architecture doc updated to reflect current status.

### 2.3 Pattern/sequence system not mentioned in architecture doc milestones

**Where:** `docs/gluon-architecture.md` Development Milestones section.

**Reality:** Named patterns (`manage_pattern`), arrangement sequences (`manage_sequence`), pattern mode vs song mode, and the full sequence editor are all shipped. The M4 description mentions only chains. Patterns and sequences are significant shipped capabilities.

**Status:** The roadmap covers this properly. Architecture doc milestones are a summary; no fix needed beyond the status marker updates.

### 2.4 Motif system, chain recipes, modulation recipes

**Where:** Not mentioned in any public-facing doc.

**Reality:** `src/engine/motif.ts`, `src/engine/chain-recipes.ts`, `src/engine/modulation-recipes.ts` are shipped features with corresponding AI tools (`manage_motif`, `apply_chain_recipe`, `apply_modulation`).

**Status:** These are internal capabilities. No doc fix needed, but worth noting for completeness.

### 2.5 Patch library

**Where:** Mentioned in roadmap as "Also in scope" for Finalization.

**Reality:** `src/engine/patch-library.ts` exists with `save_patch`, `load_patch`, `list_patches` tools. Already shipped.

**Status:** Roadmap lists it as in-scope but does not note it's landed.

### 2.6 Scale/key constraints, groove DNA, spectral slots, mix roles

**Where:** Not mentioned in docs beyond the CLAUDE.md memory.

**Reality:** `set_scale`, `shape_timbre`, `assign_spectral_slot`, `set_mix_role`, `set_tension`, `set_section`, `set_intent` — all shipped tools with engine support.

**Status:** Internal capabilities. Protocol doc could list them but this is not an error.

### 2.7 Circuit breaker

**Where:** Not mentioned in public docs.

**Reality:** `src/ai/circuit-breaker.ts` is shipped and wired into the AI loop. This is part of the #945 resilient agentic architecture work.

**Status:** Roadmap mentions #945 but does not note the circuit breaker specifically landed.

### 2.8 `edit_pattern` tool

**Where:** Protocol doc lists `sketch` and `transform` as the only pattern-writing tools.

**Reality:** `edit_pattern` is a separate tool for batch add/remove/modify operations on patterns. It is a significant shipped capability not reflected in the protocol spec.

**Status:** Protocol doc is a design spec, not a comprehensive tool list. But it should be noted as incomplete.

---

## 3. Stale or Superseded Contracts

### 3.1 CLAUDE.md model version

**Where:** `CLAUDE.md` line 11 says "Gemini 2.5 Pro (planner) + Gemini Flash (listener)".

**Reality:** Code uses `gemini-3.1-pro-preview-customtools` (planner) and `gemini-3-flash-preview` (listener). The roadmap correctly says "Gemini 3.1 Pro".

**Fix:** CLAUDE.md updated.

### 3.2 Architecture doc "Technical Stack" section

**Where:** `docs/gluon-architecture.md` lines 265–268 lists "Additional DSP: Rings, Clouds, Elements compiled to WASM as effects" under "Future (not in current scope)".

**Reality:** Rings, Clouds, Elements, Warps, Beads, Ripples, EQ, Compressor, Stereo, Chorus, Distortion are all compiled and shipping. This entire bullet is wrong.

**Fix:** Architecture doc updated.

---

## 4. Ambiguous — Needs Precision But Not Clearly Wrong

### 4.1 Surface view status

The roadmap (section 5C) correctly hedges that Surface is "a placeholder/hybrid rather than the full curated-surface model." The `set_surface`, `pin_control`, and `label_axes` tools exist and execute, but the Surface tab UI does not fully render all surface state. This is accurately described in the roadmap but may confuse readers of the protocol spec, which lists these tools without caveats.

### 4.2 `preserve_family` constraint level

The roadmap (Open Question 3) correctly notes only `preserve_exact` is implemented. The preservation contracts RFC describes `preserve_family` but the code has no implementation. The roadmap is honest here.

### 4.3 Piano roll view

The protocol doc lists "piano-roll (future)" as a sequencer view kind. The code references piano roll only in the `SequencerViewSlot.tsx` component as a placeholder/future option. Correctly marked as future.

### 4.4 Per-track swing

The roadmap lists this as Finalization scope. The system prompt references it, but no per-track swing parameter exists in the transport or track types. Global swing exists. Correctly marked as not-yet-shipped.

### 4.5 `automation_lane` region kind

The protocol doc defines `Region.kind` as `"pattern" | "clip" | "automation_lane"`. No `automation_lane` kind exists in the engine code. This is aspirational protocol spec.

### 4.6 Adapter boundary for external instruments

The protocol doc and architecture doc describe the adapter pattern for hardware synths, DAWs, and external MIDI instruments. The `SourceAdapter` type exists in the canonical model and is used by the Plaits adapter, but no external adapters exist. The docs frame this as architectural capability rather than shipped product, which is fair but could be more explicit.

---

## 5. Documents Audited

| Document | Verdict |
|----------|---------|
| `docs/roadmap.md` | Good overall. Tool count stale (20 vs 41). Module list incomplete. Fixed. |
| `docs/gluon-architecture.md` | Milestone statuses badly stale. Braids overclaimed. MIDI/OSC section misleading. Tech stack section wrong. Fixed. |
| `docs/gluon-interaction-protocol-v05.md` | Mostly accurate as a design spec. Permission-request flow not implemented. `edit_pattern` and many newer tools not listed. Acceptable for a spec document. |
| `CLAUDE.md` | Model version stale. Fixed. |

---

## 6. Fixes Applied

1. **`docs/roadmap.md`**: Updated tool count from "20-tool" to "40+ tool". Updated module list to include all shipped processors.
2. **`docs/gluon-architecture.md`**: Fixed milestone statuses (M0/M5/M6 marked COMPLETE, Finalization added). Marked Braids as future. Clarified MIDI/OSC as future/M7. Fixed "Future" tech stack section. Updated "Additional MI modules" framing.
3. **`CLAUDE.md`**: Updated Gemini model version from "2.5 Pro" to "3.1 Pro".
