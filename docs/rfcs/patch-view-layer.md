# Patch View Layer

## Parallel with the Sequencer View Layer

The sequencer architecture established a clear layering:

- **Ground truth**: the canonical model (Region, MusicalEvent)
- **Ground-truth view**: the tracker — maps 1:1 to the event list, shows everything, hides nothing
- **Projections**: step grid, piano roll — convenient filtered views for specific workflows

The same layering applies to wiring (signal chains and modulation routing):

- **Ground truth**: the chain topology and modulation routes in the data model (voice chain, modulator slots, modulation routes with source/target/depth)
- **Ground-truth view**: a node graph — maps 1:1 to the underlying graph structure, shows every node and every connection explicitly
- **Projections**: inline modulation indicators on controls (Bitwig-style), rack views (Reason-style), simplified chain strips

## The Node Graph as Ground-Truth View

A node graph (patcher) is the ground-truth view for wiring because it has the same relationship to the wiring data model that a tracker has to the event list:

- Every node in the data model has a visual node
- Every connection in the data model has a visible edge
- Nothing is hidden, filtered, or summarised
- Editing the view edits the model directly

This doesn't mean the node graph needs to look like Max. Max's visual density, connection types, and object model are far more complex than what Gluon needs. Gluon's topology is constrained: linear audio chains plus modulation routes. The node graph should reflect that simplicity.

## Projections

Other views are projections over the same data, optimised for specific tasks:

| View | Analogy | Good for | Hides |
|---|---|---|---|
| Node graph | Tracker | Full picture, debugging, understanding | Nothing |
| Inline modulation (Bitwig-style) | Step grid | Quick depth tweaks on a single parameter | Overall topology, unrelated routes |
| Chain strip | Pattern overview | Seeing what's in the chain at a glance | Modulation routing, connection details |
| Rack view (Reason-style) | — | Physical metaphor, discoverability | Internal wiring until you "flip" |

## References

- **Max/MSP**: the canonical node graph for audio. Powerful but dense. Reference for completeness, not for UX.
- **Bitwig unified modulation**: the best example of inline modulation as a projection. Modulation depth shown as rings on target controls. Great UX but doesn't show the full topology.
- **Reason**: rack metaphor with cables on the back. Constrained topology (like Gluon). Approachable.
- **VCV Rack**: virtual Eurorack. Cable-between-jacks metaphor. Relevant because Gluon runs the same DSP (Mutable Instruments).
- **Reaktor Blocks**: constrained modular layer on top of a full patcher. Interesting for the two-level approach.
- **Audulus**: modern, clean node-based audio UI. Good aesthetic reference.
- **Cables.gl**: web-native node graph. Same platform as Gluon.

## Design Constraints

- The AI builds chains and modulation routes via structured operations. The ground-truth view must be able to display what the AI built without any information loss.
- Per the human capability parity principle, every AI wiring action must have a corresponding human action in the ground-truth view.
- Projections can be added incrementally as the product needs them. The ground-truth view and the data model come first.
