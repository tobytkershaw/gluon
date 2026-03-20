# AI Memory — Per-Project

## Durable project memory through the tool contract

---

## Status

Brief. Scoped to per-project memory only. Cross-project user memory is a separate RFC: [cross-project-memory.md](../rfcs/cross-project-memory.md).

---

## The Problem

Session state persists (tracks, patterns, chat), but the AI's *understanding* of that state does not. The collaboration state that aesthetic-direction.md describes — reaction history, observed patterns, restraint level, approved/rejected directions — is re-derived from the most recent 10 reactions each turn. When the context window compresses and drops older exchanges, those learnings vanish.

Concrete failures:

- The AI re-suggests an approach the user already rejected 20 turns ago, because the rejection aged out of the reaction window.
- The AI doesn't know why a track sounds the way it does — it went through four iterations, but only the final state is in the compressed state. It proposes changes that revisit already-rejected territory.
- The AI forgets a structural decision ("intro should be 8 bars sparse") because it was stated in chat, not in a durable field, and the chat was compressed.

These are not model failures. The model has no access to the information. It's an environment failure: the collaboration state described in aesthetic-direction.md is volatile when it should be durable.

---

## Relationship to Existing Docs

This brief **extends** the collaboration state described in [aesthetic-direction.md](../ai/aesthetic-direction.md) and [ai-musical-environment.md](../ai/ai-musical-environment.md). It does not create a parallel subsystem.

The aesthetic-direction doc says: "Taste is not a separate system. It is what happens when collaboration state is rich enough and the model is prompted to use it well." This brief agrees. The problem is that collaboration state currently has a ~10-reaction memory horizon. Making it durable is not adding a taste subsystem — it's making the existing collaboration state actually work across long sessions.

The aesthetic-direction doc also deferred persistent *cross-session* user taste. This brief does not touch that. Cross-project memory is addressed separately in an RFC that explicitly revisits that deferral with the required evidence.

---

## Design

### Three memory types

All project-scoped. All stored in the existing IndexedDB project store alongside session state.

**`direction`** — approved or rejected creative directions with rationale. Durable replacement for the volatile `approved_directions` / `rejected_directions` that currently exist only in the reaction-derived collaboration state.

```
"Kick stays dry and punchy — user approved after comparing roomier version"
"Wide stereo bass rejected — user said 'too fizzy', likely timbral not spatial"
"User has rejected density additions twice this session — prefers sparse"
```

**`track-narrative`** — what was tried on a track and why it landed where it did. The journey, not just the destination.

```
"Bass: started FM (too clinical), tried waveshaping (harsh at high harmonics),
settled on virtual-analog with Ripples LP4. User happy with warmth."
```

**`decision`** — structural or arrangement decisions. The plan, not just the current section.

```
"Intro should be 8 bars sparse before the kick enters. Drop builds from bar 17.
Breakdown at bar 33 strips to just the pad."
```

### Memory structure

```typescript
interface ProjectMemory {
  id: string;
  type: 'direction' | 'track-narrative' | 'decision';
  content: string;          // natural language, 1-3 sentences
  confidence: number;       // 0.0-1.0
  evidence: string;         // what produced this memory
  trackId?: string;         // if about a specific track
  createdAt: number;
  updatedAt: number;
}
```

Stored in `session.memories: ProjectMemory[]`, persisted with the project in IndexedDB. No separate database — memories are part of the project, deleted when the project is deleted.

### Tools

Memory reads and writes go through the tool contract. No hidden side effects.

#### `save_memory`

Save or update a project memory. Creates a new memory or updates an existing one if the content supersedes it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | yes | `direction`, `track-narrative`, or `decision` |
| `content` | string | yes | Natural language, 1-3 sentences |
| `evidence` | string | yes | What produced this memory (e.g. "user undid bass widening and said 'too fizzy'") |
| `trackId` | string | no | Target track if memory is track-specific |
| `supersedes` | string | no | Memory ID to replace (e.g. updating a track narrative after further iteration) |

Validation:
- Content must be non-empty, max 500 characters
- Evidence must be non-empty
- `trackId` must reference an existing track if provided
- `supersedes` must reference an existing memory if provided
- Max 30 memories per project (prevents unbounded growth)

Undoable. Produces a `MemorySnapshot` for undo.

Appears in the action log like any other tool call. The human sees "AI saved a memory: [content]" in the chat action trail.

#### `recall_memories`

Load detailed memories, optionally filtered. Returns matching memories as structured data.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | no | Filter to memories about a specific track |
| `type` | string | no | Filter by memory type |

Read-only. Does not modify session state.

#### `forget_memory`

Remove a memory that is no longer accurate.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memoryId` | string | yes | Memory ID to remove |
| `reason` | string | yes | Why this memory is being removed |

Undoable. Produces a `MemorySnapshot` for undo.

### What goes in the context window

**Always loaded (index):** A compressed summary of all active project memories, included in the compressed state alongside track data. A few hundred tokens.

```
## Project Memory (7 memories)
- Direction: dark minimal techno, Surgeon reference. Kick approved dry+punchy. Bass rejected wide stereo ("too fizzy"). User prefers sparse — 2 density additions rejected.
- Track v0 (Kick): approved, four-on-floor anchor, dry. No changes needed.
- Track v1 (Bass): settled after 3 iterations. VA+Ripples. Don't revisit FM.
- Structure: 8-bar sparse intro → kick enters bar 9 → full drop bar 17.
```

**Loaded on demand (detail):** The AI calls `recall_memories` before editing a track to get the full narrative. This is an explicit, auditable tool call — not a hidden read.

### When the AI should use these tools

The AI is prompted to use `save_memory` at specific moments:

| Signal | Expected tool use |
|--------|-------------------|
| User approves AI work with rationale | `save_memory({ type: 'direction', content: '...approved...', evidence: 'user approved' })` |
| User rejects/undoes AI work | `save_memory({ type: 'direction', content: '...rejected...', evidence: 'user undid and said...' })` |
| Track settles after iteration | `save_memory({ type: 'track-narrative', trackId: '...', content: '...journey...', evidence: 'settled after N iterations' })` |
| Structural decision made in chat | `save_memory({ type: 'decision', content: '...plan...', evidence: 'user said...' })` |
| Existing memory contradicted | `save_memory({ ..., supersedes: 'old-id' })` or `forget_memory({ memoryId: 'old-id', reason: '...' })` |

These are prompted behaviors, not runtime triggers. The AI decides when to save, like it decides when to listen or when to raise a decision. The runtime validates and audits the call, same as every other tool.

### Human parity

The human can inspect every memory the AI saves — it appears in the action log. The human can undo any memory save (Cmd+Z). The human can also say "forget that" or "that's wrong" in chat, prompting the AI to call `forget_memory`.

Future: a memory panel in the UI where the human can browse, edit, and delete memories directly. But even without that panel, the action-log visibility + undo + chat commands provide parity from day one.

---

## Relationship to existing systems

**Reaction history** (`session.reactionHistory`): stays as-is. It's the raw signal stream — recent evidence. Memories are durable understanding derived from that stream but surviving beyond its 10-reaction window.

**Observed patterns** / **restraint level**: currently re-derived each turn from recent reactions. With project memory, `direction` memories provide a longer-term signal that stabilizes these derivations. The derivation logic can weight both recent reactions and durable direction memories.

**Intent** (`session.intent`): stays as-is. It's the human's stated brief. Direction memories are what the AI learned about that brief's implications through iteration.

**Context summary** (`contextSummary`): currently tries to preserve creative decisions when compressing dropped exchanges. With memory, the most important decisions are already captured as memories before exchanges are dropped. The summary can focus on conversational flow.

---

## Implementation

### Storage

Add `memories: ProjectMemory[]` to `Session`. Persisted via the existing project-store auto-save path. No new IndexedDB database needed.

### Tools

Add `save_memory`, `recall_memories`, and `forget_memory` to the tool registry alongside the existing 47 tools. Same validation/dispatch/undo path.

### Compression

Add a `projectMemory` section to the compressed state in `state-compression.ts`. Summarize all memories into a compact index (natural language, not JSON). Cap at ~300 tokens.

### Prompt

Add guidance to the system prompt: when to save memories, when to recall them, when to forget them. Frame memory as a collaboration tool — "save what you learn so you don't forget it" — not as a data collection mechanism.

### Undo

`save_memory` and `forget_memory` produce undo snapshots. Undo restores the previous memory state. Memories participate in action groups like any other tool.

---

## What this does NOT include

**No cross-project user memory.** That's a separate RFC with its own evidence bar: [cross-project-memory.md](../rfcs/cross-project-memory.md).

**No confidence decay.** Project memories are durable for the life of the project. Confidence decay is a cross-project concern (taste that hasn't been confirmed in months).

**No automatic promotion.** No runtime that watches for patterns across projects. That belongs in the cross-project RFC.

**No standalone taste subsystem.** Memories extend the collaboration state. They use the same natural-language format, serve the same prompting strategy, and are subject to the same advisory (not enforced) semantics as the existing reaction history and observed patterns.

---

## When this approach would be wrong

If the 30-memory cap proves too small for complex projects. If the AI over-saves (every minor tweak becomes a memory) or under-saves (forgets to record important decisions). If the token cost of the memory index competes meaningfully with track state in the 170K budget.

These are tuning problems, not design problems. The forcing function is the walkthrough: does the AI make better decisions with durable project memory than without it?
