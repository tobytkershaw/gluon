// Thin C ABI wrapper around Mutable Instruments Elements.
// Elements is a physical modeling synthesizer with exciter + resonator.
//
// TODO: This wrapper requires the actual MI Elements source files to be
// placed in wasm/elements/dsp/ and wasm/elements/resources.{cc,h}.
// Fetch from https://github.com/pichenettes/eurorack/tree/master/elements
//
// Elements runs at 32 kHz internally (elements::kSampleRate = 32000).
// The wrapper handles sample rate conversion if needed.

#include <algorithm>
#include <cstdint>
#include <cstring>

#include "elements/dsp/part.h"
#include "elements/dsp/patch.h"

namespace {

using elements::Part;
using elements::Patch;
using elements::PerformanceState;
using elements::kMaxBlockSize;

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

struct ElementsState {
  Part part;
  Patch patch;
  PerformanceState performance;

  // Reverb buffer required by Part::Init (32768 uint16_t)
  uint16_t reverb_buffer[32768];

  // I/O buffers
  float blow_in[kMaxBlockSize];
  float strike_in[kMaxBlockSize];
  float main_out[kMaxBlockSize];
  float aux_out[kMaxBlockSize];

  // Smoothed exciter parameters
  SmoothedParam smooth_bow_level;
  SmoothedParam smooth_bow_timbre;
  SmoothedParam smooth_blow_level;
  SmoothedParam smooth_blow_timbre;
  SmoothedParam smooth_strike_level;
  SmoothedParam smooth_strike_timbre;

  // Smoothed resonator parameters
  SmoothedParam smooth_coarse;
  SmoothedParam smooth_fine;
  SmoothedParam smooth_geometry;
  SmoothedParam smooth_brightness;
  SmoothedParam smooth_damping;
  SmoothedParam smooth_position;

  // Smoothed space (reverb)
  SmoothedParam smooth_space;

  bool gate_open;

  ElementsState() : gate_open(false) {
    std::memset(&patch, 0, sizeof(patch));
    std::memset(&performance, 0, sizeof(performance));
  }
};

// Tiny DC offset to prevent denormal floating-point numbers.
static const float DENORMAL_GUARD = 1e-25f;

inline float clamp01(float value) {
  return std::max(0.0f, std::min(1.0f, value));
}

}  // namespace

extern "C" {

void* elements_create(float sample_rate) {
  auto* state = new ElementsState();

  state->part.Init(state->reverb_buffer);

  // Default patch: moderate exciter levels, centered resonator
  state->patch.exciter_envelope_shape = 0.5f;
  state->patch.exciter_bow_level = 0.0f;
  state->patch.exciter_bow_timbre = 0.5f;
  state->patch.exciter_blow_level = 0.0f;
  state->patch.exciter_blow_meta = 0.5f;
  state->patch.exciter_blow_timbre = 0.5f;
  state->patch.exciter_strike_level = 0.8f;
  state->patch.exciter_strike_meta = 0.5f;
  state->patch.exciter_strike_timbre = 0.5f;
  state->patch.resonator_geometry = 0.5f;
  state->patch.resonator_brightness = 0.5f;
  state->patch.resonator_damping = 0.5f;
  state->patch.resonator_position = 0.5f;
  state->patch.space = 0.3f;

  // Init smoothed params
  state->smooth_bow_level.reset(0.0f);
  state->smooth_bow_timbre.reset(0.5f);
  state->smooth_blow_level.reset(0.0f);
  state->smooth_blow_timbre.reset(0.5f);
  state->smooth_strike_level.reset(0.8f);
  state->smooth_strike_timbre.reset(0.5f);
  state->smooth_coarse.reset(0.5f);
  state->smooth_fine.reset(0.5f);
  state->smooth_geometry.reset(0.5f);
  state->smooth_brightness.reset(0.5f);
  state->smooth_damping.reset(0.5f);
  state->smooth_position.reset(0.5f);
  state->smooth_space.reset(0.3f);

  state->performance.gate = false;
  state->performance.note = 48.0f;
  state->performance.modulation = 0.0f;
  state->performance.strength = 0.5f;

  return state;
}

void elements_destroy(void* handle) {
  delete static_cast<ElementsState*>(handle);
}

void elements_set_patch(
    void* handle,
    float bow_level, float bow_timbre,
    float blow_level, float blow_timbre,
    float strike_level, float strike_timbre,
    float coarse, float fine,
    float geometry, float brightness,
    float damping, float position,
    float space
) {
  auto* state = static_cast<ElementsState*>(handle);
  if (!state) return;

  state->smooth_bow_level.set(clamp01(bow_level));
  state->smooth_bow_timbre.set(clamp01(bow_timbre));
  state->smooth_blow_level.set(clamp01(blow_level));
  state->smooth_blow_timbre.set(clamp01(blow_timbre));
  state->smooth_strike_level.set(clamp01(strike_level));
  state->smooth_strike_timbre.set(clamp01(strike_timbre));
  state->smooth_coarse.set(clamp01(coarse));
  state->smooth_fine.set(clamp01(fine));
  state->smooth_geometry.set(clamp01(geometry));
  state->smooth_brightness.set(clamp01(brightness));
  state->smooth_damping.set(clamp01(damping));
  state->smooth_position.set(clamp01(position));
  state->smooth_space.set(clamp01(space));
}

void elements_set_model(void* handle, int model) {
  auto* state = static_cast<ElementsState*>(handle);
  if (!state) return;
  // model 0 = modal resonator, model 1 = string resonator
  int clamped = std::max(0, std::min(model, 1));
  state->part.set_resonator_model(static_cast<elements::ResonatorModel>(clamped));
}

void elements_set_note(void* handle, float note) {
  auto* state = static_cast<ElementsState*>(handle);
  if (!state) return;
  state->performance.note = note;
}

void elements_gate(void* handle, int gate) {
  auto* state = static_cast<ElementsState*>(handle);
  if (!state) return;
  state->gate_open = (gate != 0);
}

int elements_render(void* handle, const float* input, float* out_left, float* out_right, int num_frames) {
  auto* state = static_cast<ElementsState*>(handle);
  if (!state || !out_left || !out_right || num_frames <= 0) return 0;

  constexpr float kSmoothCoeff = 0.4f;
  int rendered = 0;

  while (rendered < num_frames) {
    const size_t block = std::min(static_cast<size_t>(num_frames - rendered), static_cast<size_t>(kMaxBlockSize));

    // Advance smoothed parameters
    state->smooth_bow_level.step(kSmoothCoeff);
    state->smooth_bow_timbre.step(kSmoothCoeff);
    state->smooth_blow_level.step(kSmoothCoeff);
    state->smooth_blow_timbre.step(kSmoothCoeff);
    state->smooth_strike_level.step(kSmoothCoeff);
    state->smooth_strike_timbre.step(kSmoothCoeff);
    state->smooth_coarse.step(kSmoothCoeff);
    state->smooth_fine.step(kSmoothCoeff);
    state->smooth_geometry.step(kSmoothCoeff);
    state->smooth_brightness.step(kSmoothCoeff);
    state->smooth_damping.step(kSmoothCoeff);
    state->smooth_position.step(kSmoothCoeff);
    state->smooth_space.step(kSmoothCoeff);

    // Apply smoothed values to patch
    state->patch.exciter_bow_level = state->smooth_bow_level.current;
    state->patch.exciter_bow_timbre = state->smooth_bow_timbre.current;
    state->patch.exciter_blow_level = state->smooth_blow_level.current;
    state->patch.exciter_blow_timbre = state->smooth_blow_timbre.current;
    state->patch.exciter_strike_level = state->smooth_strike_level.current;
    state->patch.exciter_strike_timbre = state->smooth_strike_timbre.current;
    state->patch.resonator_geometry = state->smooth_geometry.current;
    state->patch.resonator_brightness = state->smooth_brightness.current;
    state->patch.resonator_damping = state->smooth_damping.current;
    state->patch.resonator_position = state->smooth_position.current;
    state->patch.space = state->smooth_space.current;

    // Map coarse + fine to note offset
    // coarse: 0-1 maps to full pitch range (set via set_note)
    // fine: 0-1 maps to -1..+1 semitones
    float note = state->performance.note + (state->smooth_fine.current - 0.5f) * 2.0f;
    state->performance.note = note;
    state->performance.strength = 0.5f;
    state->performance.gate = state->gate_open;

    // Prepare input buffers (blow and strike get external input + denormal guard)
    if (input) {
      for (size_t i = 0; i < block; ++i) {
        state->blow_in[i] = input[rendered + i] + DENORMAL_GUARD;
        state->strike_in[i] = input[rendered + i] + DENORMAL_GUARD;
      }
    } else {
      for (size_t i = 0; i < block; ++i) {
        state->blow_in[i] = DENORMAL_GUARD;
        state->strike_in[i] = DENORMAL_GUARD;
      }
    }

    state->part.Process(
      state->performance,
      state->patch,
      state->blow_in,
      state->strike_in,
      state->main_out,
      state->aux_out,
      block
    );

    // Copy stereo output
    for (size_t i = 0; i < block; ++i) {
      out_left[rendered + i] = state->main_out[i];
      out_right[rendered + i] = state->aux_out[i];
    }

    rendered += static_cast<int>(block);
  }

  return rendered;
}

}
