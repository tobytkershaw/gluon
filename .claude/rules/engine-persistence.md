---
paths:
  - "src/engine/persistence.ts"
---

# Persistence Rules

- Pattern is derived, never persisted as authoritative. On load, always re-project from regions.
- v1 sessions (no regions) must be migrated by hydrating regions from legacy step arrays.
- Strip _hiddenEvents, undoStack (closures), and recentHumanActions before saving.
- Transport is always persisted as stopped (playing: false).
