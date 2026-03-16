// Thin C ABI wrapper around Mutable Instruments Rings.
#include <algorithm>
#include <cstdint>
#include <cstring>

#include "rings/dsp/part.h"
#include "rings/dsp/string_synth_part.h"
#include "rings/dsp/patch.h"
#include "rings/dsp/performance_state.h"

namespace {

using rings::Part;
using rings::StringSynthPart;
using rings::Patch;
using rings::PerformanceState;
using rings::ResonatorModel;
using rings::kMaxBlockSize;

// One-pole lowpass for parameter smoothing (prevents clicks on parameter jumps).
struct SmoothedParam {
  float current;
  float target;

  void set(float value) { target = value; }
  void reset(float value) { current = target = value; }

  void step(float coeff) {
    current += coeff * (target - current);
  }
};

struct RingsState {
  Part part;
  Patch patch;
  PerformanceState performance;

  // Reverb buffer required by Part::Init (64K uint16_t = 128KB)
  uint16_t reverb_buffer[65536];

  // I/O buffers
  float in_buffer[kMaxBlockSize];
  float out_buffer[kMaxBlockSize];
  float aux_buffer[kMaxBlockSize];

  // Smoothed parameters
  SmoothedParam smooth_structure;
  SmoothedParam smooth_brightness;
  SmoothedParam smooth_damping;
  SmoothedParam smooth_position;

  // Fine tune offset in semitones, applied at render time (not accumulated)
  float fine_tune_offset;

  bool strum_pending;

  RingsState() : fine_tune_offset(0.0f), strum_pending(false) {
    std::memset(&patch, 0, sizeof(patch));
    std::memset(&performance, 0, sizeof(performance));
  }
};

// Tiny DC offset added to signals before recursive processing to prevent
// denormal floating-point numbers. WASM enforces strict IEEE 754 and cannot
// set FTZ/DAZ CPU flags, so without this guard, recursive algorithms that
// decay toward silence can cause 100x CPU slowdown.
static const float DENORMAL_GUARD = 1e-25f;

inline float clamp01(float value) {
  return std::max(0.0f, std::min(1.0f, value));
}

}  // namespace

extern "C" {

void* rings_create() {
  auto* state = new RingsState();

  state->part.Init(state->reverb_buffer);
  state->part.set_model(rings::RESONATOR_MODEL_MODAL);
  state->part.set_polyphony(1);

  state->patch.structure = 0.5f;
  state->patch.brightness = 0.5f;
  state->patch.damping = 0.7f;
  state->patch.position = 0.5f;

  state->smooth_structure.reset(0.5f);
  state->smooth_brightness.reset(0.5f);
  state->smooth_damping.reset(0.7f);
  state->smooth_position.reset(0.5f);

  state->performance.strum = false;
  state->performance.internal_exciter = true;
  state->performance.internal_strum = false;
  state->performance.internal_note = false;
  state->performance.tonic = 48.0f;
  state->performance.note = 0.0f;
  state->performance.fm = 0.0f;
  state->performance.chord = 0;

  return state;
}

void rings_destroy(void* handle) {
  delete static_cast<RingsState*>(handle);
}

void rings_set_model(void* handle, int model_index) {
  auto* state = static_cast<RingsState*>(handle);
  if (!state) return;
  int clamped = std::max(0, std::min(model_index, static_cast<int>(rings::RESONATOR_MODEL_LAST) - 1));
  state->part.set_model(static_cast<ResonatorModel>(clamped));
}

void rings_set_polyphony(void* handle, int polyphony) {
  auto* state = static_cast<RingsState*>(handle);
  if (!state) return;
  state->part.set_polyphony(std::max(1, std::min(polyphony, 4)));
}

void rings_set_patch(void* handle, float structure, float brightness, float damping, float position) {
  auto* state = static_cast<RingsState*>(handle);
  if (!state) return;
  state->smooth_structure.set(clamp01(structure));
  state->smooth_brightness.set(clamp01(brightness));
  state->smooth_damping.set(clamp01(damping));
  state->smooth_position.set(clamp01(position));
}

void rings_set_note(void* handle, float tonic, float note) {
  auto* state = static_cast<RingsState*>(handle);
  if (!state) return;
  state->performance.tonic = tonic;
  state->performance.note = note;
}

void rings_set_fine_tune(void* handle, float offset) {
  auto* state = static_cast<RingsState*>(handle);
  if (!state) return;
  // Fine tune: store offset in semitones (not accumulated).
  // Normalized 0-1 maps to -1..+1 semitones. Applied in rings_render.
  state->fine_tune_offset = (offset - 0.5f) * 2.0f;
}

void rings_set_internal_exciter(void* handle, int enabled) {
  auto* state = static_cast<RingsState*>(handle);
  if (!state) return;
  state->performance.internal_exciter = enabled != 0;
}

void rings_strum(void* handle) {
  auto* state = static_cast<RingsState*>(handle);
  if (!state) return;
  state->strum_pending = true;
}

int rings_render(void* handle, const float* input, float* output, int num_frames) {
  auto* state = static_cast<RingsState*>(handle);
  if (!state || !output || num_frames <= 0) return 0;

  constexpr float kSmoothCoeff = 0.4f;
  int rendered = 0;

  while (rendered < num_frames) {
    const size_t block = std::min(static_cast<size_t>(num_frames - rendered), kMaxBlockSize);

    // Advance smoothed parameters
    state->smooth_structure.step(kSmoothCoeff);
    state->smooth_brightness.step(kSmoothCoeff);
    state->smooth_damping.step(kSmoothCoeff);
    state->smooth_position.step(kSmoothCoeff);

    state->patch.structure = state->smooth_structure.current;
    state->patch.brightness = state->smooth_brightness.current;
    state->patch.damping = state->smooth_damping.current;
    state->patch.position = state->smooth_position.current;

    // Copy input (or silence if no input provided), adding denormal guard
    if (input) {
      for (size_t i = 0; i < block; ++i) {
        state->in_buffer[i] = input[rendered + i] + DENORMAL_GUARD;
      }
    } else {
      for (size_t i = 0; i < block; ++i) {
        state->in_buffer[i] = DENORMAL_GUARD;
      }
    }

    state->performance.strum = state->strum_pending;
    state->strum_pending = false;

    // Apply fine tune offset to a copy of performance state so the base
    // note is never permanently mutated.
    PerformanceState perf = state->performance;
    perf.note += state->fine_tune_offset;

    state->part.Process(
      perf,
      state->patch,
      state->in_buffer,
      state->out_buffer,
      state->aux_buffer,
      block
    );

    // Copy main output
    for (size_t i = 0; i < block; ++i) {
      output[rendered + i] = state->out_buffer[i];
    }

    rendered += static_cast<int>(block);
  }

  return rendered;
}

}
