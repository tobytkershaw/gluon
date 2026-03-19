# Human Capability Parity

## Principle

Anything the AI can do, the human should have a means to do for themselves.

The AI is a collaborator, not a gatekeeper. If the AI can wire a modulation route, the human should be able to wire one manually. If the AI can sketch a pattern, the human should be able to edit that pattern directly. The AI accelerates — it should never be the only path.

## Why This Matters

Without this principle, Gluon risks becoming an AI wrapper where the human's only recourse is to describe what they want in words and hope the AI interprets correctly. That violates the core thesis: the human directs, the AI assists. Direction requires the ability to act directly.

This also keeps the AI honest. When the human can inspect and reproduce what the AI did, the AI's actions remain legible. When the AI is the only way to reach a capability, that capability becomes opaque.

## Relationship to Existing Principles

This complements the AI Capability Doctrine's hard boundaries:

- **"The human's hands win"** — assumes the human *has* hands on the controls. This principle ensures those controls exist.
- **"AI actions are inspectable"** — inspection is necessary but not sufficient. The human should also be able to *act*, not just observe.
- **"AI actions are undoable"** — undo reverts. This principle says the human can also *redo differently*, by hand.

## Implications for UI

Every AI-facing tool should have a corresponding human-facing surface:

| AI capability | Human surface | Status |
|---|---|---|
| Sketch a pattern | Step grid + tracker editing | Done |
| Set track parameters | Parameter space (XY pad, sliders) | Done |
| Add/remove processors | Rack view (chain strip) | Done |
| Create modulation routes | Rack view (modulator panel) | Done |
| Set modulation depth | Rack view (inline control) | Done |
| Change track model | Model selector | Done |
| Set BPM / swing | Transport bar | Done |
| Add/remove tracks | Track sidebar | Done |
| Mute / solo / agency | Track sidebar buttons | Done |
| Manage sends | Rack view | Done |

The human surface doesn't need to be identical to the AI's tool interface — it should be idiomatic for direct manipulation. The AI works through structured operations; the human works through visual controls and direct editing.
