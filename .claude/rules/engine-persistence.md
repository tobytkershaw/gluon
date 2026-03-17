---
paths:
  - "src/engine/persistence.ts"
---

# Persistence Rules

- Pattern is derived, never persisted as authoritative. On load, always re-project from regions.
- v1 sessions (no regions) must be migrated by hydrating regions from legacy step arrays.
- Strip undoStack (closures) and recentHumanActions before saving. Everything else on Voice persists as-is (including views and _hiddenEvents).
- Transport is always persisted as stopped (status: 'stopped').
