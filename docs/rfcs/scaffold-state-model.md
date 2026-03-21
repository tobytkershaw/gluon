# RFC: Scaffold State Model

**Status:** Draft
**Issue:** #1382
**Epic:** #1380 (Creative Scaffolding)
**Depends on:** [Binding Contract](binding-contract.md)

## Problem

The creative scaffolding brief requires the AI to build rigs that remain meaningful across turns. The system must track what was scaffolded, distinguish durable controls (Surface) from transient ones (Live Controls), detect when scaffolded controls become invalid, and support promotion from transient to durable.

Today's state model has the pieces but no connective tissue:
- `TrackSurface` is stored on the Track and replaced wholesale by `set_surface`
- `LiveControlModule[]` lives in React state, not session state
- There is no `propose_controls` tool — the AI has no path to create live controls
- There is no provenance tracking — no record of whether a module was AI-composed or human-edited
- Clearing untouched live controls happens eagerly at turn start

## Design

### Two tiers, one type

Surface modules and live control modules share the same `SurfaceModule` type with the same `BindingTarget` contract. The difference is lifecycle, not structure:

| | Surface | Live Controls |
|---|---|---|
| **Storage** | `Track.surface.modules` (session state, persisted) | `Session.liveControls` (session state, persisted) |
| **Lifespan** | Permanent until explicitly replaced | Short-lived — see lifecycle rules below |
| **Author** | AI via `set_surface`, human via surface editor | AI via `propose_controls` only |
| **Undo** | `SurfaceSnapshot` (existing) | Not undoable (explicit product choice — see rationale below) |
| **Promotion** | N/A | "Add to Surface" moves to track surface |

### Move live controls into session state

Today `LiveControlModule[]` is React component state (`useState` in `App.tsx`). This means:
- Lost on page refresh
- Not visible to the AI (not in compressed state)
- Not part of undo history
- Not serialized to IndexedDB

**Change:** Move `liveControls: LiveControlModule[]` onto `Session`. This makes live controls:
- Persisted across refreshes (IndexedDB)
- Visible to state compression (the AI can see what controls it proposed)
- Part of the session snapshot

The `LiveControlModule` type gains a timestamp for lifecycle enforcement:

```typescript
interface LiveControlModule {
  id: string;
  trackId: string;
  touched: boolean;
  createdAtTurn: number;   // turn counter at creation time (for expiry)
  module: SurfaceModule;   // same type, same BindingTarget contract
}
```

### Live control lifecycle rules

Persisting live controls in session state means they survive page refreshes — so the lifecycle must be explicit and enforced, not just "cleared at next turn." These are the rules:

| Trigger | Untouched modules | Touched modules |
|---|---|---|
| **Next AI turn starts** | Removed | Kept |
| **Session load (page refresh)** | Removed (stale proposals) | Kept |
| **Track deleted** | Removed (orphaned) | Removed (orphaned) |
| **3 AI turns without further interaction** | N/A (already removed) | Removed (grace period expired) |

**The core rule:** Untouched live controls survive exactly one AI turn boundary. Touched live controls survive until (a) promoted to Surface, (b) 3 AI turns pass without the human interacting again, or (c) the owning track is deleted.

**Implementation:** The `clearStaleLiveControls()` function runs at two points:
1. **AI turn start** — remove untouched modules; for touched modules, check if `currentTurn - createdAtTurn > 3` and remove if so.
2. **Session load** — remove all untouched modules (stale proposals from before refresh); keep touched modules subject to the same turn-distance check.

This prevents `session.liveControls` from becoming a graveyard. The 3-turn grace period is generous enough that the human won't lose controls they're actively using, but bounded enough that old touched controls don't accumulate.

### Why live controls are not undoable

This is an explicit product choice, not an oversight. Live controls are AI suggestions, not project mutations. They are the equivalent of the AI saying "try turning this knob" — the suggestion appearing is not a change to the user's work, and its disappearance is not data loss.

The user-visible consequence: a `propose_controls` call adds modules to the panel that are persisted (survive refresh) but cannot be individually undone. This is acceptable because:
- The modules are visually distinct (violet "Live" badge) — the user knows they're suggestions
- Untouched modules disappear automatically — no manual cleanup needed
- The only persistent effect is promotion, which IS undoable (creates a `SurfaceSnapshot`)
- The panel has a "dismiss" affordance (closing/ignoring is the implicit undo)

### The `propose_controls` tool

New AI tool that creates live control modules:

```typescript
{
  name: 'propose_controls',
  description: 'Propose transient controls in the Live Controls panel. These are exploration aids — untouched controls are cleared on the next turn. The human can promote any control to the Surface via "Add to Surface".',
  parameters: {
    trackId: string,       // target track
    description: string,   // what these controls are for
    modules: [{
      type: string,        // module type from registry (knob-group, macro-knob, xy-pad only for now)
      label: string,       // human-readable label
      bindings: [{         // same BindingTarget contract as set_surface
        role: BindingRole,
        target: BindingTarget,
      }],
      config: Record<string, unknown>,
    }],
  },
}
```

**Restrictions for Slice 1:** Only `knob-group` and `macro-knob` types. `xy-pad` added in Slice 2. Region-based modules (step-grid, piano-roll) don't make sense as transient controls — those belong on the Surface.

**Handler:** Creates `LiveControlModule` instances with `createdAtTurn` set to the current turn counter, appends to `session.liveControls`. No undo snapshot (see "Why live controls are not undoable" above).

### Binding validity tracking

The binding contract's `resolveBinding()` returns `stale` or `unsupported` when a target is invalid. The scaffold state model uses this for ongoing validity:

- **On AI turn start:** Before clearing untouched modules, resolve all live control bindings. Log stale bindings but don't auto-remove — the human may want to see what broke.
- **On Surface render:** Resolve each module's bindings. Stale bindings render as disconnected (visual treatment is renderer's concern — see interaction semantics RFC).
- **After AI edits:** If the AI removes a processor that a surface module binds to, the module stays but its bindings resolve as stale. The module is not silently removed.

No separate validity state is needed — `resolveBinding()` computes validity on demand from the live Track state. This is correct because validity is a function of current state, not a cached property that can drift.

### Promotion path

"Add to Surface" already works (App.tsx lines 1214-1253). The change is:

1. Live controls now come from `session.liveControls` instead of React state
2. On promotion: append module to `track.surface.modules`, create `SurfaceSnapshot` for undo, remove from `session.liveControls`
3. The promoted module keeps its bindings and config — no transformation needed since both tiers use the same `SurfaceModule` type

### State compression

Live controls appear in compressed state **only when touched**. Untouched modules are the AI's own recent proposals — including them would be the AI reasoning from its own leftovers, not from meaningful collaboration state.

Touched modules are meaningful: the human interacted with them, which signals interest in that control dimension. This is collaboration state, not UI residue.

```
Live Controls (human-engaged):
  Track 1: "Pattern Density" (knob-group, control→source:morph) [touched]
```

The label "human-engaged" and the `[touched]` marker make the semantics clear to the planner: these controls exist because the human found them useful, not because the AI proposed them last turn.

### What this does NOT add

- **Provenance tracking:** No `author: 'ai' | 'human'` field on modules. The distinction is tier-based: Surface modules may have been AI-composed or human-edited (doesn't matter — they're committed). Live controls are always AI-proposed. If we need finer provenance later, it's additive.
- **Module-level undo for live controls:** Transient by design. If the human accidentally promotes a bad module, they undo the promotion (which is a Surface mutation with a snapshot).
- **AI awareness of human surface edits:** The AI sees the current surface in compressed state. It doesn't need to know the edit history — the current state is the truth.

## Files affected

| File | Change |
|---|---|
| `src/engine/types.ts` | Add `liveControls: LiveControlModule[]` to `Session` |
| `src/engine/session.ts` | Initialize `liveControls: []` in default session |
| `src/ai/tool-schemas.ts` | Add `propose_controls` tool definition |
| `src/ai/api.ts` | Add `propose_controls` handler, update `set_surface` for new binding format |
| `src/ai/state-compression.ts` | Add live controls to compressed state output |
| `src/ui/App.tsx` | Remove `useState` for live controls, read from `session.liveControls`, update `clearUntouchedLiveModules` to mutate session |
| `src/ui/LiveControlsPanel.tsx` | No change (props-driven) |
| `src/ui/LiveModuleRenderer.tsx` | Wire `onChange` through `resolveBinding`/`writeBinding` |

## Implementation order

1. Move `liveControls` to Session type and session initialization
2. Update App.tsx to read/write from session instead of local state
3. Add `propose_controls` tool schema and handler
4. Wire LiveModuleRenderer to binding resolver (Slice 1: knob-group only)
5. Add live controls to state compression
6. Promotion path already works — verify after session state migration
