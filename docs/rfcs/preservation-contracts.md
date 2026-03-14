# RFC: Preservation Contracts
## Protecting approved material during AI edits

---

## Status

Design RFC. Defines how Gluon enforces preservation of approved musical material when the AI makes edits. A prerequisite for reliable taste-informed behavior ([aesthetic-direction.md](../ai/aesthetic-direction.md)).

---

## Problem

Music collaboration requires protecting important musical ideas. The AI must be able to expand, vary, and refine material without accidentally destroying what the human has already approved.

Without enforceable preservation, "respect what's been approved" is a prompt instruction that the model may ignore under pressure — especially during complex multi-voice edits or phrase-level operations. Preservation must be a runtime invariant, not a suggestion.

---

## Approval Levels

Musical artifacts carry explicit approval status:

| Level | Meaning | AI behavior |
|-------|---------|-------------|
| **exploratory** | Default. Work in progress, no commitment. | May freely edit or replace. |
| **liked** | Human has reacted positively but not committed. | Should preserve unless asked to change. |
| **approved** | Human has explicitly approved this material. | Must preserve during expansion. Edits require explicit request. |
| **anchor** | Core identity of the track. | Must preserve exact characteristics. Changes require human confirmation. |

These levels apply to voices, patterns, parameter states, and timbral configurations. A voice might be `approved` while its pattern is `anchor` — the approval is granular.

---

## Preservation Contracts

Expansion tools reference structured preservation constraints. A contract specifies what must survive an edit, what may change, and at what level of fidelity.

```
preservation_contract: {
  target: "v0",
  constraints: [
    { kind: "rhythm",  subject: "kick",    rule: "preserve_exact" },
    { kind: "contour", subject: "bass",    rule: "preserve_family" },
    { kind: "timbre",  subject: "hats",    rule: "may_change" },
    { kind: "energy",  subject: "overall", rule: "increase_slightly" }
  ]
}
```

### Constraint Rules

- **preserve_exact** — the specified aspect must not change. Rhythm stays identical, timbre stays within epsilon.
- **preserve_family** — the musical shape is maintained but details may vary. A bass contour keeps its direction and emphasis points but may change specific notes.
- **may_change** — explicitly marked as open for modification. Helps the model know where it has freedom.
- **directional** — a qualitative target (increase, decrease, brighten, darken) without a specific value.

---

## Preservation Reports

Every edit that operates under a preservation contract returns a report:

```
preservation_report: {
  preserved: ["kick rhythm", "bass contour shape"],
  altered: ["hat syncopation"],
  drift_risks: ["energy increase may mask kick transient"],
  violations: []
}
```

- **preserved** — aspects that were maintained per the contract
- **altered** — aspects that were changed (should fall within `may_change` or `preserve_family` latitude)
- **drift_risks** — potential side effects the model identified but did not prevent
- **violations** — contract rules that were broken. Should be empty. If not, the edit should be flagged for human review.

The model should include the preservation report in its response to the human, at least for approved and anchor material.

---

## Partial Approvals

Users can approve components of a voice independently:

- approve the kick identity (timbre + rhythm)
- approve the bass contour (melodic shape)
- approve the timbral direction (parameter range)
- approve the groove relationship between two voices

This allows fine-grained collaboration. The human can lock down the parts that matter while leaving other aspects open for AI exploration.

### Tools

Two collaboration tools handle approval:

**`mark_approved(trackId, aspect, level)`** — set approval level on a specific aspect of a voice. Aspect can be `"all"`, `"pattern"`, `"timbre"`, `"params"`, or a specific element like `"rhythm"`.

**`preserve_material(trackId, constraints)`** — attach a preservation contract to a voice before an expansion operation. The operation executor validates the contract before applying edits.

---

## Artifact Lineage

Variants record their ancestry so the model (and human) can trace how material evolved.

```
lineage: {
  derived_from: "v0_loop_a",
  preserves: ["bass contour", "kick rhythm"],
  contrasts: ["hat density", "snare energy"]
}
```

Lineage supports:
- understanding what changed between variants during comparison
- knowing which preservation contracts were in effect when a variant was created
- undoing back to an ancestor state if a line of exploration fails

---

## Runtime Enforcement

Preservation is enforced by the operation executor, not by prompt compliance alone.

1. Before applying a set of edits, the executor checks whether any preservation contracts apply to the target voices.
2. For `preserve_exact` constraints, the executor validates that the protected aspects are unchanged in the proposed result.
3. For `preserve_family` constraints, validation is softer — the executor checks that the musical shape is plausibly maintained (exact validation rules TBD, likely involving contour similarity and rhythm edit distance).
4. Violations are rejected with an error that explains what was protected and why. The model can then revise its approach.

This means the model can attempt edits freely, knowing the runtime will catch preservation violations before they reach the project state. The guardrail is structural, not behavioral.

---

## Implementation

### Dependencies

- Approval status must be storable per voice and per aspect in the session state
- The operation executor must support pre-application validation
- Preservation contracts must be passable as parameters to expansion tools

### Incremental Steps

**Step 1: Approval levels.** Add approval status to voice state. Expose `mark_approved` tool. Include approval levels in compressed state so the model sees them.

**Step 2: Simple preservation.** Add `preserve_exact` checking for pattern rhythm. When a voice's pattern is `approved` or `anchor`, reject sketch operations that change the rhythm unless the user explicitly asked for it.

**Step 3: Preservation contracts.** Add the full contract structure. Expansion tools accept contracts as parameters. The executor validates before applying.

**Step 4: Preservation reports.** Return structured reports from edits that operated under contracts. Include in model responses and potentially in UI.

---

## Relationship to Other Docs

- [aesthetic-direction.md](../ai/aesthetic-direction.md) — taste-informed behavior depends on preservation being enforceable
- [ai-musical-environment.md](../ai/ai-musical-environment.md) — the collaboration tools (`mark_approved`, `preserve_material`) are additions to the E family
- [ai-collaboration-model.md](../principles/ai-collaboration-model.md) — preservation is central to the expansion phase: "preserve the approved identity while increasing scope"
- [canonical-musical-model.md](./canonical-musical-model.md) — preservation operates on canonical model types (voices, regions, events)
