# Product Identity: Intelligent Instrument

## Gluon is a self-configuring intelligent instrument, not an easier DAW.

This distinction shapes every design decision. When it's unclear whether a feature belongs in Gluon, this is the test.

## What an instrument is

An instrument is something you play. It makes sound. It responds to your input. You develop a relationship with it over time. A piano, a modular synth, a drum machine, an MPC — these are instruments.

An instrument has opinions. A piano's voicing shapes what you play. A 303's filter defines a sound. An MPC's pads and timing define a workflow. The instrument is not neutral — it participates in the music.

Gluon is an instrument that also configures itself. It adapts its controls to the music (Surface view), remembers what you liked (reaction history), knows what to protect (preservation contracts), and has two kinds of intelligence — structural reasoning and sonic intuition — that inform each other before it acts.

## What a DAW is

A DAW is a studio. You bring material in, arrange it on a timeline, process it with effects, mix it, and export it. The DAW is neutral — it doesn't have opinions about your music. It's a workspace that accommodates any workflow.

AI in a DAW is an assistant that helps you operate the studio faster: auto-mixing, stem splitting, reference track analysis, arrangement suggestions. The AI makes the studio easier. The studio itself doesn't change.

## The difference

| | Instrument | DAW |
|---|---|---|
| **Relationship** | You play it | You operate it |
| **Sound** | It makes sound | It hosts things that make sound |
| **AI role** | Part of the instrument — it has ears, taste, memory | Assistant that automates studio tasks |
| **Adaptation** | Configures itself to the music | Configures itself to the workflow |
| **Identity** | Has character and opinions | Neutral workspace |

## What belongs in Gluon

Features that make the instrument more expressive, more responsive, or more intelligent.

- A sampler source — an MPC is an instrument. Loading samples, building a library, playing them back — these are instrument capabilities.
- Cross-model consultation — the instrument thinks before it acts. It has structural reasoning (GPT) and sonic intuition (Gemini) that confer internally.
- Preservation contracts — the instrument remembers what you approved and protects it. A collaborator with taste.
- Parameter automation — the instrument can shape sound over time. Expressiveness.
- Resampling — the instrument can capture its own output and feed it back. Self-referential creativity.
- Audio analysis — the instrument can hear itself and evaluate its own work.

## What doesn't belong in Gluon

Features that make Gluon a better studio but don't make it a better instrument.

- Stem splitting of imported tracks — that's a studio/engineering operation. You don't import other people's music into an instrument to take it apart.
- Reference track analysis — "make it sound like this song" is a valid conversation to have with the AI. But importing a track and splitting it into components is a studio workflow, not instrument interaction.
- Automated mixing/mastering as a service — mixing is what you do in a studio after you've finished playing. Gluon's mixing capabilities (bus tracks, sends, volume, pan) exist because an instrument needs a way to balance its voices, not because Gluon is a mixing tool.
- Project management, file format compatibility, broad plugin hosting — these are studio infrastructure.

## The grey zone

Some capabilities could go either way. The test is: does this make the instrument more expressive and responsive, or does this make the studio more efficient?

- **Arrangement / scenes**: an instrument can have song structure (Elektron's song mode, Ableton's Session View as a performance tool). This belongs if it's about performing and composing, not about arranging and editing.
- **MIDI output to hardware**: an instrument can control other instruments. This belongs if Gluon is playing the hardware, not just routing MIDI.
- **Import/export**: an instrument can receive new sounds (samples) and send its output somewhere (render, export). The mechanics are fine. It's the framing that matters — these are instrument I/O, not studio file management.

## Why this matters

The market for AI-assisted DAWs is crowded and getting more so. Every major DAW is adding AI features. Startups are building AI wrappers around production workflows. Competing on "easier DAW" means competing with Ableton, Logic, FL Studio, and every AI startup, all on their home turf.

The market for AI-native instruments barely exists. The closest things are hardware instruments with limited intelligence (Elektron's parameter locks, Teenage Engineering's generative features) and AI generation tools that produce finished audio with no human control (Suno, Udio).

Gluon occupies the space between: an instrument with deep intelligence that the human plays. That's the product identity worth protecting.

## How to use this document

When evaluating a feature proposal, ask:

1. Does this make Gluon a better instrument, or a better studio?
2. Would a musician describe this as "playing" or "operating"?
3. Does this give the instrument more character and responsiveness, or more utility and compatibility?
4. Is this something you'd expect from an instrument that understands music, or from a workspace that accommodates any workflow?

If the answer is consistently "instrument," build it. If it's consistently "studio," it doesn't belong — or it needs reframing to fit the instrument identity.
