# Audit Framework

Repeatable audit process for finding latent bugs, contract drift, and structural fragility across Gluon subsystems.

Last updated: 2026-03-17.

---

## Purpose

The goal of an audit is not just to find isolated bugs. It is to identify where Gluon has multiple sources of truth, silent contract drift, weak parity guarantees, or lifecycle paths that are not protected by tests.

For UI and control-surface audits, this also means comparing:
- what Gluon planned to build
- what Gluon currently claims to have built
- what the user actually needs in order to use Gluon as intended
- whether the resulting experience is usable and aligned with Gluon's design principles

For implementation-shape audits, this also means checking whether Gluon is following established orthodoxy everywhere it reasonably can, and documenting principled reasons for any deviation.

Use this framework when auditing:
- audio modules
- transport and scheduler behavior
- persistence and undo
- AI tool and executor contracts
- UI/control-surface consistency
- usability and design-principle compliance
- orthodoxy and implementation-pattern compliance
- future source or processor integrations

---

## Audit Principles

1. Audit contracts, not just symptoms
- Start from what the system claims to do.
- Compare that against what the runtime actually does.

2. Treat duplicated logic as a risk signal
- If live, offline, persistence, and UI each redefine the same mapping or behavior, assume drift until proven otherwise.

3. Prefer parity questions over feature questions
- Ask whether two paths that should agree actually agree.
- In Gluon, parity failures are a recurring bug source.

4. Audit lifecycle edges, not only happy paths
- Create
- update
- teardown
- stop/restart
- reload
- undo
- failure/fallback

5. Every finding should point to a missing invariant
- A useful audit result is either:
  - a correctness bug to fix now, or
  - an invariant/descriptor/contract to formalize so the bug class does not recur

6. Usability is part of correctness for user-facing systems
- If a capability exists but is too hidden, indirect, misleading, or cognitively expensive to use reliably, treat that as an audit concern.

7. Design principles are product constraints, not mood boards
- For UI audits, compare implementation against the relevant principles and briefs, especially:
  - `docs/principles/human-capability-parity.md`
  - `docs/principles/ai-interface-design-principles.md`
  - `docs/rfcs/view-architecture.md`
  - `docs/rfcs/ai-curated-surfaces.md`
  - `docs/briefs/visual-language.md`

8. Default to orthodoxy unless there is a named reason not to
- Outside the canonical musical model and AI collaboration layer, Gluon should prefer established patterns from trackers, DAWs, modular patchers, racks, and Web Audio architecture.
- Hybrid designs are a risk signal and should be presumed fragile until justified.

9. Deviations must be explicit, not accidental
- If Gluon departs from orthodoxy, the audit should state:
  - what the orthodox pattern is
  - what Gluon is doing instead
  - why the deviation exists
  - whether it is justified, temporary, or unjustified

---

## Standard Audit Pass

Every subsystem audit should run these passes.

### 1. Contract Pass

Document the subsystem's declared contract:
- what the UI exposes
- what types/registries/adapters declare
- what persistence stores
- what live runtime claims to support
- what offline/export/test harness claims to support

For product-facing audits, also document:
- what roadmap/RFC/principle docs planned
- what `docs/status.md` and current product copy claim
- what the intended user workflow actually requires
- what design/usability principles the subsystem is supposed to uphold

For orthodoxy-facing audits, also document:
- what the orthodox pattern is for this subsystem
- which reference docs establish that pattern

Then compare against actual implementation behavior.

Questions:
- What is the canonical public API for this subsystem?
- Which files define it?
- Is there one canonical mapping table, or several partial ones?
- Are there public controls/events/ports that are accepted but ignored?
- Are there private fallback behaviors that change the real contract?
- Is the implementation behind the project docs, ahead of them, or in conflict with them?
- Is the product claiming a capability that is only partially real?
- Is there a capability the user needs for intended use that is still missing even if the current implementation is internally consistent?
- Is the feature merely present, or is it usable enough for the intended workflow?
- Does the implementation respect the intended design split and interaction model, or does it technically exist while violating the product's principles?
- What established implementation pattern should this subsystem follow?
- Is Gluon following that pattern, adapting it, or mixing multiple patterns together?

### 2. Parity Pass

Compare all execution paths that should agree:
- live vs offline render
- UI state vs engine state
- persisted state vs restored state
- declared topology vs actual topology
- scheduler intent vs worklet timing
- AI-issued operation vs engine-applied result

Questions:
- If the same change is expressed through two paths, do they produce the same result?
- Are all exposed controls honored equally in all paths?
- Are timing semantics preserved at block boundaries and across transport transitions?
- Does the app describe channels, ports, or capabilities more richly than runtime really supports?

### 3. Lifecycle Pass

Exercise boundary behavior:
- initialization
- incremental updates
- bypass/enable/disable
- play/pause/stop/restart
- add/remove/rebuild
- save/load
- undo/redo
- error/fallback/recovery

Questions:
- What happens when the subsystem is created and destroyed repeatedly?
- What state is leaked, duplicated, or left stale?
- Does fallback preserve contract clarity or silently substitute a different implementation?
- Does undo restore runtime reality, not just state objects?

### 4. Usability And Design-Principles Pass

For user-facing audits, explicitly evaluate whether the implemented experience matches Gluon's intended interaction model and design principles.

Questions:
- Can a user discover the capability at the moment they need it?
- Can they perform the task directly, or do they have to route through chat or hidden affordances?
- Is the control surface legible, trustworthy, and appropriately scoped for its view?
- Do canonical views behave like stable ground truth rather than curated or decorative surfaces?
- Does the Surface behave like a performative, curated layer rather than a placeholder or overloaded inspector?
- Does the UI help the human stay in control, or does it force them to reverse-engineer the system?
- Is motion, visual emphasis, and interaction density informative rather than decorative or distracting?
- Are the interactions consistent with the "human directs, AI assists" model?

### 5. Test Coverage Pass

Map findings against current tests.

Questions:
- Which behaviors are actually locked in by tests?
- Which tests only verify a narrow regression while leaving the contract unprotected?
- Which invariants should be covered by contract tests or parity tests?

Required output:
- tests that already cover the area
- tests that create false confidence
- tests that should be added

### 6. Orthodoxy Pass

Explicitly compare the subsystem against the relevant established implementation pattern.

Primary references:
- `docs/orthodox-patterns-reference.md`
- `docs/orthodoxy-audit-current.md`
- `docs/orthodoxy-audit-planned.md`
- `docs/design-references.md`

Questions:
- What is the orthodox pattern for this subsystem?
- Which flagship tools or standards establish that pattern?
- Is Gluon following the pattern cleanly?
- If not, is the deviation:
  - justified by browser/Web Audio constraints
  - required by the AI collaboration model
  - deliberate product differentiation
  - pragmatic but temporary
  - unjustified hybridization
- Has the deviation already caused bugs, complexity, or drift?
- Should the deviation be codified as accepted debt, fixed now, or documented as a durable design decision?

---

## Audit Output Template

Every audit should produce the following sections:

1. Scope
- subsystem(s) audited
- files inspected
- tests run
- product docs compared

2. Findings
- ordered by severity
- each finding includes:
  - severity
  - short title
  - user/system impact
  - why it happens
  - relevant files

3. Structural advice
- changes to contracts, descriptors, abstractions, or invariants
- not just bug-level fixes

4. Product alignment
- what was planned
- what is currently claimed
- what is actually implemented
- what is required for intended user workflows
- gaps between those layers

5. Usability and design-principle alignment
- which product/design principles apply
- where the UX supports them
- where the UX violates them
- what blocks the intended human-AI workflow

6. Orthodoxy alignment
- orthodox pattern for the subsystem
- relevant references
- how Gluon compares
- deviation classification
- whether the deviation is principled, temporary, or risky

7. Test gaps
- missing contract tests
- missing parity tests
- missing lifecycle/failure tests

8. Recommended issue split
- concrete bugs to fix now
- structural refactors to prevent recurrence
- usability/design issues that need direct product work
- orthodoxy debt or unjustified hybrids that need architectural cleanup

---

## Severity Model

Use this severity model for audits:

- `P0`
  - user-visible correctness break
  - silent data loss/corruption
  - live/offline divergence that invalidates core workflows
  - runtime behavior that materially violates the public contract

- `P1`
  - contract drift that will reliably cause bugs as the system evolves
  - topology/state/runtime mismatch
  - missing invariant or shared abstraction causing duplicated truth

- `P2`
  - observability, degraded-mode, naming, or coverage weakness
  - does not break core behavior today but makes future bugs easier to introduce or harder to diagnose

For usability/design findings:
- escalate to `P1` when the UX materially undermines human capability parity, trust, or intended direct manipulation
- keep at `P2` when the issue is friction or clarity debt without blocking the intended workflow

For orthodoxy findings:
- `P1` when an unjustified or weakly justified hybrid is already creating bugs, drift, or complexity debt
- `P2` when the deviation is survivable for now but should be regularized or documented before the area grows

Use this deviation rubric:
- `justified`
  - browser/Web Audio constraint, AI-specific requirement, or deliberate product differentiation with a coherent reason
- `pragmatic-temporary`
  - simpler for current scope, but should converge toward orthodoxy later
- `unjustified`
  - accidental hybridization, unclear rationale, or a weaker pattern without compensating benefit

---

## GitHub Issue Taxonomy

Use the existing backlog conventions from `AGENTS.md`.

### Labels

For audit-produced issues:
- always add `audit`
- add one area label:
  - `infrastructure`
  - `sequencer`
  - `canonical-model`
  - `phase-4a`
  - `phase-4`
  - `ai-models`
- add one priority label:
  - `priority:now`
  - `priority:next`
  - `priority:later`

Add `bug` only when the issue is a concrete correctness problem rather than a structural cleanup.

### Milestones

Choose the milestone that matches the work:
- `M0: Stabilization` for correctness, parity, lifecycle, and QA hardening
- `M5: UI Layers` for view/control-surface consistency work
- `M6: Collaboration` for AI contract, preservation, listening, and collaboration-state audits
- `M7: External Integration` only for external adapter/hardware/DAW audits

### Recommended split

When an audit finds both symptoms and root causes, split into:
1. parity/correctness issue
2. shared-contract / abstraction / refactor issue

Do not collapse both into one issue if they can land independently.

---

## Subsystem Matrix

Use this matrix to scope an audit and to identify unexamined parity surfaces.

| Subsystem | Contract | Live runtime | Offline/export | Persistence | Undo/redo | Topology/routing | Failure/fallback | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Source modules |  |  |  |  |  |  |  |  |
| Processor modules |  |  |  |  |  |  |  |  |
| Modulators |  |  |  |  |  |  |  |  |
| Transport/scheduler |  |  |  |  |  |  |  |  |
| Chain/routing |  |  |  |  |  |  |  |  |
| Persistence/session |  |  |  |  |  |  |  |  |
| Undo/arbitration |  |  |  |  |  |  |  |  |
| AI tools/executor |  |  |  |  |  |  |  |  |
| UI/control surfaces |  |  |  |  |  |  |  |  |

Mark each cell as:
- `verified`
- `partial`
- `drift`
- `not audited`

This should become the running map of audit coverage for the codebase.

For orthodoxy audits, attach a deviation table:

| Subsystem | Orthodox pattern | Gluon approach | Deviation class | Reason | Risk |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

For UI/control-surface audits, attach a second matrix:

| Surface area | Planned | Claimed | Implemented | Required for intended use | Usable | Principle-aligned | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tracker |  |  |  |  |  |  |  |
| Rack |  |  |  |  |  |  |  |
| Patch |  |  |  |  |  |  |  |
| Surface |  |  |  |  |  |  |  |
| Transport |  |  |  |  |  |  |  |
| Mix / track controls |  |  |  |  |  |  |  |
| Human parity for AI tools |  |  |  |  |  |  |  |

Use these statuses:
- `aligned`
- `partial`
- `claimed > implemented`
- `implemented > documented`
- `missing for intended use`
- `usable with friction`
- `principle drift`

---

## Recommended Audit Order

Recommended next sequence for Gluon:

1. Transport and scheduler audit
- timing semantics
- pause/resume/stop/restart
- lookahead/fence behavior
- loop boundaries
- block-boundary timing parity

2. Chain and routing lifecycle audit
- module add/remove
- rebuild and reconnect behavior
- send/return routing
- bus cleanup
- stale connections and duplicate nodes

3. Persistence and undo audit
- save/load parity
- migration behavior
- undo grouping
- runtime state that is not serialized
- AI edits vs human edits

4. UI, control-surface, and usability audit
- roadmap/RFC intent vs `docs/status.md` claims vs real implementation
- canonical-view completeness for Tracker, Rack, and Patch
- Surface-view reality vs the AI-curated-surface thesis
- whether the human can actually operate Gluon as intended without falling back to chat for missing direct-manipulation paths
- usability of the intended workflows, not just feature presence
- compliance with human-capability parity and AI-interface design principles
- design split between canonical trust surfaces and expressive Surface presentation
- registry vs UI vs adapter vs runtime names
- defaults, ranges, labels, normalization
- hidden vs stored vs automated controls

5. Orthodoxy audit for core implementation patterns
- scheduler and transport patterns
- tracker/editor patterns
- rack and parameter-surface patterns
- patcher/topology patterns
- worklet/runtime communication patterns
- module integration patterns
- classify deviations as justified, pragmatic-temporary, or unjustified

6. AI action contract audit
- tool schema vs executor behavior
- state compression vs runtime authority
- validation and consequence reporting
- operations the AI can express but the engine cannot faithfully realize

7. External adapter readiness audit
- only after the internal contracts above are stabilized
- apply the same framework to MIDI/hardware/DAW integration

---

## Required Test Types

Each audited subsystem should end with explicit test recommendations across these categories:

### Contract tests
- Verify the declared public contract is actually honored.

Examples:
- every exposed control is applied
- every declared port/topology path exists
- every accepted event type changes runtime state as documented

### Parity tests
- Verify two execution paths produce equivalent outcomes.

Examples:
- live vs offline
- save -> load
- UI edit vs AI-issued edit
- scheduler intent vs rendered timing

### Lifecycle tests
- Verify setup, teardown, rebuild, restart, and undo paths.

Examples:
- add/remove modules repeatedly
- play/stop/restart while editing
- bypass/re-enable during playback
- rebuild chain without leaked state

### Failure-mode tests
- Verify degraded paths are explicit and safe.

Examples:
- failed module load
- invalid control IDs
- stale routing targets
- partial persistence restoration

### Product-alignment checks
- Verify the user-facing workflow described by roadmap/status/RFC docs is actually possible.

Examples:
- every claimed canonical view exposes the expected ground truth
- the human can perform the same category of action the AI can perform
- the Surface view behaves like a real curated control surface rather than a placeholder
- the documented intended workflow is achievable without hidden or AI-only steps

### Usability and design-principle checks
- Verify the UX is direct, legible, and aligned with the product's interaction principles.

Examples:
- core actions are discoverable at the point of use
- canonical views remain stable, exact, and trustworthy
- Surface is expressive without obscuring control or truth
- motion and visual treatment communicate state rather than decoration
- the human can inspect, reproduce, and override important AI actions
- the interface does not require the user to remember hidden model-only concepts to operate it

### Orthodoxy checks
- Verify the implementation follows established robust patterns where Gluon is not intentionally novel.

Examples:
- transport follows the orthodox state-machine and timing model
- tracker editing follows established tracker interaction patterns
- rack and patch views follow proven inspection/editing patterns rather than unstable hybrids
- worklet communication uses a pattern appropriate to the scale and timing requirements
- any deviation from orthodoxy is documented with a concrete reason and bounded scope

---

## Definition Of Done For An Audit

An audit is complete when:

1. the subsystem contract has been documented
2. major parity surfaces have been checked
3. lifecycle edges have been examined
4. test coverage has been evaluated
5. findings have been split into concrete bug issues and structural issues
6. the subsystem matrix has been updated or attached to the report

An audit is not complete when it only says "tests pass" or only lists bugs without identifying the duplicated truths or missing invariants that allowed them.

---

## Expected Long-Term Outcome

If this framework is followed consistently, Gluon should gradually converge on:
- fewer duplicated mapping tables
- fewer silent fallbacks
- stronger live/offline/save/load parity
- more honest runtime contracts
- tighter alignment between product vision, product claims, and actual usability
- better adherence to the design principles that make Gluon feel like an instrument rather than a loose collection of views
- fewer accidental hybrids and clearer use of proven system-design patterns
- reusable integration patterns for future MI and non-MI modules

That is the point of the audit process: not more reports, but fewer classes of bugs.
