# Gluon Model Capability Assessment (2026)

## Purpose

This document summarises the current understanding of frontier model capabilities and how they map onto the roles required by the Gluon architecture. It consolidates analysis of models from OpenAI, Anthropic, and Google, and proposes practical deployment stacks and evaluation strategies.

The goal is not to determine which model is "best" in general, but which models best satisfy Gluon's behavioural collaboration contract.

---

# 1. Gluon Capability Requirements

Gluon places unusual demands on language models compared with typical AI products.

The system is designed around **staged creative collaboration**, not one-shot generation. The model must therefore demonstrate the following capabilities:

## 1.1 Collaboration Management

The model must:

- ask clarifying questions when the brief is ambiguous
- choose the smallest useful next artifact
- avoid premature structural commitment
- preserve previously approved musical material
- pause at meaningful decision points

The planner is rewarded for restraint rather than productivity.

## 1.2 Structured Tool Use

The model operates through a bounded tool interface that includes actions such as:

- sketch
- transform
- move
- listen
- set transport
- modify processors
- modify views

The model must reliably:

- choose the correct tool
- operate within constraints
- interpret tool results

## 1.3 Musical Listening

The model must be able to:

- evaluate short audio renders
- compare variations
- detect basic structural or timbral issues

Listening is used to support decisions rather than replace the human producer.

## 1.4 Long-Horizon Session Reasoning

Gluon sessions can extend over many iterations. The model must:

- track musical direction
- remember approved vs rejected ideas
- maintain structural coherence

## 1.5 Musical Tact

The model must intervene at the correct level of abstraction.

Examples:

Good:

"Let's sketch a 4-bar variation."

Bad:

"Here's a full arrangement."

This is the most distinctive requirement of Gluon.

---

# 2. Current Frontier Model Landscape

The most relevant model families for Gluon today are:

- OpenAI GPT-5.x series
- Anthropic Claude 4.x series
- Google Gemini 2.5 / 3.x series

Each has distinct strengths.

---

# 3. Role Mapping

## 3.1 Planner / Conductor

The planner manages the session.

Responsibilities:

- interpret user intent
- determine session phase
- choose next actions
- maintain collaboration pacing

### Candidate Models

**Claude Opus 4.6**

Strengths:

- careful planning
- strong restraint
- good multi-step reasoning

Claude's temperament often favours "do what is asked" rather than "solve everything".

This behaviour aligns well with Gluon's collaboration contract.


**GPT-5.4**

Strengths:

- best-in-class tool use
- strong reasoning
- large context windows

GPT-5.4 may be stronger at complex multi-step planning but can sometimes prioritise rapid task completion over restrained collaboration.


### Current Hypothesis

Two competing hypotheses should be tested:

Hypothesis A

GPT-5.4 produces the most competent planning due to superior reasoning and tool orchestration.

Hypothesis B

Claude Opus 4.6 produces better musical collaboration due to greater restraint.


Testing is required to determine which behaviour aligns better with Gluon.


---

## 3.2 Editor

The editor performs concrete musical modifications.

Responsibilities:

- apply parameter changes
- sketch patterns
- perform transformations

### Candidate Models

**GPT-5.4**

Currently the strongest tool-using model.

Advantages:

- reliable function calling
- strong reasoning
- good error recovery


**Gemini 3.1 Pro**

Advantages:

- native multimodality
- integrated reasoning across modalities

Potential concerns:

- may prioritise producing answers quickly rather than asking clarifying questions


### Likely Outcome

GPT-5.4 is the most promising editor model today.

Gemini becomes attractive if the planner and listener are also Gemini.


---

## 3.3 Listener

The listener evaluates rendered audio.

Responsibilities:

- compare variations
- detect structural issues
- assist the planner in judging edits


### Best Candidate

**Gemini 3.1 Pro**

Gemini currently has the strongest native multimodal capabilities including audio reasoning.

For Gluon this role is particularly well suited to Gemini.


Lower cost variants (e.g. Gemini Flash) may also be sufficient.

Current implementation note:

Gluon's current listener shape is a discrete evaluation tool: render an offline audio snapshot, upload the clip, and receive a text critique. That architecture fits Gemini's unary multimodal models better than a Live API session.

Near-term, this means the best-fit listener path is likely a Gemini request/response model that accepts audio input and returns text output.

Future direction:

Google's Live / native-audio path remains attractive if Gluon evolves from discrete critique toward continuous real-time listening. That would be a product and architecture change, not just a model swap, because it introduces stateful streaming sessions, audio session management, and a different interaction posture for the listener.


---

## 3.4 Engine

The engine should remain deterministic.

Responsibilities:

- validate actions
- apply transformations
- maintain undo history

The engine must never rely on LLM judgement.


---

# 4. Recommended Model Stacks

## 4.1 Experimental Best Stack

Planner: Claude Opus 4.6

Editor: GPT-5.4

Listener: Gemini 3.1 Pro


This stack uses the strongest model for each role.


## 4.2 Strong Alternative

Planner: GPT-5.4

Editor: GPT-5.4

Listener: Gemini 3.1 Pro


This configuration reduces complexity by consolidating planner and editor.

For the listener role, prefer a unary Gemini audio-reasoning model while Gluon keeps the offline render -> upload audio -> get text critique workflow. Treat Live/native-audio as a follow-on option if the product shifts toward always-on or conversational listening.


## 4.3 Single Provider Option

Planner: Gemini 3.1 Pro

Editor: Gemini 3.1 Pro

Listener: Gemini 3.1 Pro


This simplifies architecture but may sacrifice some planner behaviour quality.


## 4.4 Current Shipping Option

Planner/editor: Gemini 2.5 Pro

Listener: Gemini


This remains viable if the existing system is stable.


---

# 5. Likelihood of Sophisticated Musical Collaboration

The core question is whether current models are capable of meaningful music collaboration.


## 5.1 High Probability

Tasks likely to work well today:

- short sketch generation
- pattern mutation
- parameter adjustments
- timbral exploration


## 5.2 Medium Probability

Multi-turn collaboration that feels musically interesting.

Success depends heavily on environment design.


## 5.3 Lower Probability

Fully autonomous co-production across an entire track.

Challenges include:

- long-term aesthetic judgement
- groove intuition
- structural pacing


---

# 6. Estimated Capability Probabilities

These estimates assume Gluon's architecture is implemented as designed.

Local edits and sketches:

80-90%


Guided collaboration sessions that feel good:

50-65%


Consistently impressive co-producer behaviour:

35-55%


Autonomous musical judgement from audio alone:

25-40%


---

# 7. Key Insight

The largest bottleneck for Gluon is **environment design**, not model intelligence.

Critical factors include:

- musical state representation
- action abstraction levels
- preservation of approved material
- structured listening workflows


Well-designed collaboration protocols dramatically reduce the capability burden on the model.


---

# 8. Recommended Next Step

Run a structured model bakeoff.

Test scenarios should include:

- broad creative brief
- groove development
- timbre exploration
- preserve-and-expand tasks
- listener-assisted refinement


Models should be scored on:

- asking clarifying questions
- smallest useful intervention
- preservation of identity
- correct tool use
- appropriate listening
- correct stopping behaviour


This behavioural testing will provide more useful information than general model benchmarks.


---

# Conclusion

Current frontier models are likely capable of producing valuable musical collaboration within Gluon's staged architecture.

However, the quality of results will depend more on Gluon's behavioural contract and musical environment than on marginal differences in raw model intelligence.

The most promising near-term stack is:

Claude Opus 4.6 (planner)

GPT-5.4 (editor)

Gemini 3.1 Pro (listener)


But this should be validated through behaviour-focused testing rather than assumed from provider capabilities.
