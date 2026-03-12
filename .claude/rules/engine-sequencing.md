---
paths:
  - "src/engine/pattern-primitives.ts"
  - "src/engine/operation-executor.ts"
  - "src/engine/event-conversion.ts"
  - "src/engine/region-helpers.ts"
  - "src/engine/region-projection.ts"
---

# Sequencing Invariants

- voice.regions[0] is the sequencing source of truth. voice.pattern is always derived via reprojectVoicePattern(). Never write to pattern without writing to regions first.
- Human edits (pattern-primitives.ts) do NOT push undo snapshots. Only AI operations (operation-executor.ts) create undoable entries.
- Disabled triggers use velocity=0 as a sentinel to preserve accent state. eventsToSteps skips velocity=0 triggers. Never delete a trigger on gate-off — set velocity to 0.
- voice._hiddenEvents stores out-of-range events when pattern is shortened. Must be cleared by clearPattern(). Transient — never persisted.
- All region writes must go through normalizeRegionEvents() to maintain sorted/deduplicated invariant.
- Region invariant: all events must satisfy event.at < region.duration.
