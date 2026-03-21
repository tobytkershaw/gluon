# RFC: Interaction Semantics for Scaffolded Controls

**Status:** Draft
**Issue:** #1383
**Epic:** #1380 (Creative Scaffolding)
**Depends on:** [Binding Contract](binding-contract.md), [Scaffold State Model](scaffold-state-model.md)

## Problem

When the AI builds a scaffolded rig and the human starts tweaking it, what happens when the AI acts again? The creative scaffolding brief identifies four questions:

1. Human tweaks a scaffolded control, then the AI edits the track — does the AI preserve the control?
2. When does a live control expire?
3. What does "touched" protect?
4. What happens if the bound target disappears?

These need deterministic answers, not ad-hoc renderer behavior.

## Design

### Rule 1: Human-touched controls are preserved across AI edits

Two distinct preservation mechanisms protect human work on scaffolded controls:

**Parameter values** are protected by `controlProvenance` — the per-parameter `source: 'human' | 'ai' | 'default'` record on `Track.controlProvenance` (defined in `canonical-types.ts`). When the human drags a knob, the underlying parameter's provenance is set to `'human'`. This is a **durable** record that persists across turns. The AI sees provenance in compressed state and is guided to respect human-sourced values. Note: this is different from arbitration, which is a transient interaction-time mechanism (cooldown-based, not persistent). Provenance outlives the interaction; arbitration does not.

**Surface layout** (which modules exist, their bindings and labels) is preserved unless the AI explicitly calls `set_surface` to replace the surface. The AI should not replace a surface that the human has been actively using. System prompt guidance teaches this:

> If the human has interacted with controls on the current surface, preserve the surface layout. Add new modules or update labels, but do not replace modules the human has touched.

This is a prompt-level guideline, not a hard runtime constraint. The AI can always replace a surface if the human asks ("redesign the surface", "start over"). The safety net is undo — `set_surface` creates a `SurfaceSnapshot`, so any replacement is one undo away.

### Rule 2: Live controls expire at the next AI turn unless touched

**Current behavior (preserved):** `clearUntouchedLiveModules()` runs at AI turn start, filtering out modules where `touched === false`.

**Refined behavior** (aligned with scaffold-state-model lifecycle rules):

| State | What happens at next AI turn |
|---|---|
| Untouched | Removed from `session.liveControls` |
| Touched, within 3-turn grace period | Kept |
| Touched, 3+ turns without further interaction | Removed (grace period expired) |
| Promoted | Already moved to Surface — no longer in live controls |

"Next AI turn" means the next time `handleSend` is called (the human sends a message). This is the existing trigger point. The 3-turn grace period for touched controls prevents the live panel from accumulating old controls indefinitely while being generous enough that the human won't lose controls mid-workflow. See scaffold-state-model.md for the full lifecycle table including session-load behavior.

**Multi-step AI turns:** If the AI calls `propose_controls` multiple times within one turn (e.g. proposes controls for two different tracks), all proposed modules accumulate. None are cleared mid-turn. Clearing only happens at the start of the *next* human-initiated turn.

### Rule 3: "Touched" means the human interacted with the control

`touched` is set to `true` when any of these happen:
- The human drags a knob in a live control module
- The human clicks a step in a live step-grid (if we add step-grid to live controls later)
- The human clicks "Add to Surface" (promotion counts as interaction)

`touched` is NOT set by:
- The AI updating the underlying parameter via `move` or other tools
- The module being rendered or scrolled into view
- Time passing

Once `touched === true`, it stays true for the lifetime of the live control module. There is no "un-touch."

### Rule 4: Stale bindings render as disconnected, not removed

When a binding's target disappears (processor removed, pattern deleted, modulator removed), the binding resolver returns `{ status: 'stale', reason: '...' }`. The module is **not silently removed**.

**Surface modules with stale bindings:**
- Render in a disconnected state (dimmed, with a warning indicator)
- Knobs/pads become inert — dragging them does nothing
- The stale reason is available as tooltip text
- The human can remove the module manually, or the AI can replace the surface

**Live controls with stale bindings:**
- Same disconnected rendering
- Still subject to the normal expiry rules (cleared if untouched at next turn)
- If touched, they persist in disconnected state — the human chose to keep them, so they shouldn't silently vanish

**Why not auto-remove?** The human may want to see what broke. If the AI removes a processor and three surface knobs go stale, that's visible feedback about the consequence of the edit. Silent removal hides cause and effect.

### Rule 5: AI edits to scaffolded tracks

When the AI edits a track that has scaffolded controls (surface modules or live controls), the following rules apply:

**Parameter changes (`move`, `sketch`):** The existing `controlProvenance` system handles this. If a parameter's provenance is `source: 'human'`, the AI sees this in compressed state and is guided to respect it. Transient arbitration (interaction cooldowns) prevents mid-drag conflicts. No special scaffold logic needed.

**Processor/modulator changes (`manage_processor`, `manage_modulator`):** Adding a processor doesn't affect existing bindings. Removing a processor that has bindings causes those bindings to resolve as `stale`. The AI should be guided (via system prompt) to check for bindings before removing processors, but the system degrades gracefully if it doesn't.

**Surface replacement (`set_surface`):** Replaces the entire surface. This is a heavy operation with undo. The AI should only do this when recomposing the interface (not when tweaking one parameter). System prompt guidance:

> Use `set_surface` to compose or recompose a track's interface. Do not call it to change a single parameter — use `move` for that. If the human has been interacting with the current surface, prefer adding modules over replacing the whole surface.

**Live control proposal (`propose_controls`):** Additive — new modules are appended. The AI can propose new controls without affecting existing ones. If the AI wants to replace its previous proposals, it calls `propose_controls` with `replace: true`, which clears **only untouched** modules for that track before adding new ones. Touched modules are never removed by `replace: true` — the human has signalled interest in them, and the AI should not silently discard that. If the AI needs to clear everything (including touched modules), it should ask the human first.

### Interaction flow example

```
Turn 1: Human says "add hi-hats"
  AI: set_surface → step-grid, "Character" macro, "Openness" macro
  AI: propose_controls → "Density" knob, "Swing" knob
  → Surface has 3 modules, Live Controls has 2 modules

Human drags "Character" macro knob, drags "Density" live knob
  → Character's underlying params marked source:'human' in controlProvenance
  → Density live module is marked touched

Turn 2: Human says "make it brighter"
  → clearStaleLiveControls() removes "Swing" (untouched), keeps "Density" (touched)
  AI: move → adjusts harmonics and timbre (provenance shows human-sourced, AI warned)
  AI: propose_controls → "Brightness" knob (new suggestion)
  → Surface unchanged (AI didn't call set_surface)
  → Live Controls: "Density" (touched, kept), "Brightness" (new, untouched)

Turn 3: Human says "add reverb"
  → clearStaleLiveControls() removes "Brightness" (untouched), keeps "Density" (touched)
  AI: manage_processor → adds Clouds reverb
  AI: set_surface → adds "Wet/Dry" knob to surface (preserves existing modules)
  AI: propose_controls → "Size" knob, "Texture" knob
  → Surface now has 4 modules, Live Controls: "Density" + 2 new
```

### Disconnected state rendering

When `resolveBinding()` returns `stale` or `unsupported`:

**Visual treatment** (renderer concern, not specified in detail):
- Module border or background shifts to a muted/warning state
- Inert controls show a disconnected icon or label
- Tooltip shows the reason string from the resolver

**Behavioral treatment** (contract):
- `writeBinding()` returns `stale` or `unsupported` — the renderer does not dispatch mutations
- The module stays in the DOM — not hidden or removed
- The "Add to Surface" button on live controls remains functional (promotes the disconnected module — the human can reconnect it later by editing bindings)

## What this does NOT change

- **Arbitration and provenance:** Unchanged. `controlProvenance` (durable, per-parameter) and arbitration (transient, interaction-time) both continue to work as designed. The scaffold layer sits above them, not beside them.
- **Undo:** Surface changes remain undoable via `SurfaceSnapshot`. Live controls remain non-undoable (transient).
- **Agency:** The AI still needs creation authority to build scaffolds. `propose_controls` follows the same agency rules as `set_surface`.

## Files affected

| File | Change |
|---|---|
| `src/ai/system-prompt.ts` | Add scaffolding interaction guidelines |
| `src/ui/surface/*.tsx` | Add disconnected state rendering for stale bindings |
| `src/ui/LiveModuleRenderer.tsx` | Add disconnected state, enforce `touched` semantics |
| `src/ui/App.tsx` | Refine `clearUntouchedLiveModules`, add per-track replace logic |
| `src/ai/tool-schemas.ts` | Add `replace` option to `propose_controls` |

## Open questions

1. **Touched live control grace period.** Aligned with scaffold-state-model: touched controls expire after 3 turns without further interaction. This prevents panel clutter while being generous enough for active workflows.

2. **Should the AI see stale binding state in compression?** Probably yes — if the AI can see that a surface module's binding is stale, it can proactively offer to fix it. Deferred to state compression implementation.
