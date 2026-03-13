# QA Report Template

## Environment

- Date:
- Branch:
- Commit:
- API configured: `yes` / `no`
- Browser automation mode:

## Phase A: Preflight

- `npx tsc --noEmit`:
- `npx vitest run`:
- `npm run build`:
- `npm run lint`:
- Notes:

## Phase B1: Deterministic Browser Scenarios

| Scenario | Result | Artifacts | Notes |
| --- | --- | --- | --- |
| App boot |  |  |  |
| View switching |  |  |  |
| Active voice continuity |  |  |  |
| Tracker dedicated view |  |  |  |
| Keyboard guard |  |  |  |
| Tracker edit commit/cancel |  |  |  |
| Transport UI |  |  |  |
| Voice stage |  |  |  |
| Deep view |  |  |  |
| Persistence smoke |  |  |  |

## Known-Issue Reproduction Matrix

| Issue | Result | Notes |
| --- | --- | --- |
| #118 |  |  |
| #120 |  |  |
| #121 |  |  |
| #129 |  |  |
| #130 |  |  |
| #131 |  |  |
| #132 |  |  |
| #135 |  |  |
| #137 |  |  |
| #149 |  |  |
| #150 |  |  |
| #153 |  |  |

## Phase B2: Live AI Smoke

| Prompt / Scenario | Result | Artifacts | Notes |
| --- | --- | --- | --- |
| Chat-only response |  |  |  |
| Parameter move |  |  |  |
| Transport change |  |  |  |
| Structural action |  |  |  |
| UI curation action |  |  |  |
| Sequencing action |  |  |  |

## Phase C: Human Checkpoint 1

- Result:
- Notes:

Checklist:
- Layout coherent across views:
- Tracker more usable in dedicated view:
- No obvious UI drift:
- Deep view / stage / chain surfaces coherent:
- Agency visibility correct:
- Edit lifecycle correct:

## Phase D: Human Checkpoint 2

- Result:
- Notes:

Checklist:
- Transport playback sanity:
- Rings / Clouds audition:
- Tides modulation audition:
- AI small sound change:
- AI movement request:
- AI sequencing request:
- Undo sanity:
- Persistence after reload:

## Findings

### Blocking

- 

### Non-Blocking Follow-Ups

- 

### Flaky / Needs Retest

- 

## Decision

- `pass`
- `pass with follow-up issues`
- `stop and fix blockers`
