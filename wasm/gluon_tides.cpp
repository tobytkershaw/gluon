// Thin C ABI wrapper around Mutable Instruments Tides v2.
// Tides is used as a modulation source (LFO/envelope generator).
// No audio input — generates output waveform only.
#include <algorithm>
#include <cstdint>
#include <cstring>

#include "tides2/poly_slope_generator.h"

namespace {

using tides::PolySlopeGenerator;
using tides::RampMode;
using tides::OutputMode;
using tides::Range;
using tides::RAMP_MODE_AD;
using tides::RAMP_MODE_LOOPING;
using tides::RAMP_MODE_AR;
using tides::OUTPUT_MODE_AMPLITUDE;
using tides::RANGE_CONTROL;

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

struct TidesState {
  PolySlopeGenerator generator;
  PolySlopeGenerator::OutputSample output_buffer[128];
  stmlib::GateFlags gate_buffer[128];

  // Smoothed parameters (normalized 0-1)
  SmoothedParam smooth_frequency;
  SmoothedParam smooth_shape;
  SmoothedParam smooth_slope;
  SmoothedParam smooth_smoothness;
  SmoothedParam smooth_shift;

  // Mode: 0=AD, 1=Looping, 2=AR
  int ramp_mode;
  // Output mode (0=amplitude, 1=frequency, 2=phase, 3=tidal)
  int output_mode;
  // Range (0=control, 1=audio)
  int range;

  TidesState() : ramp_mode(1), output_mode(1), range(0) {}
};

inline float clamp01(float value) {
  return std::max(0.0f, std::min(1.0f, value));
}

// Map normalized frequency (0-1) to Tides internal frequency.
// Range: ~0.001 Hz to ~20 Hz in control rate mode.
// The Tides frequency param is in units of "phase increment per sample".
// At 48kHz, frequency = target_hz / 48000.
// We map 0-1 exponentially: 0 = ~0.01 Hz, 0.5 = ~0.5 Hz, 1.0 = ~20 Hz
inline float mapFrequency(float normalized) {
  // Exponential mapping: 0.01 * exp(normalized * ln(2000))
  // This gives range 0.01 Hz to 20 Hz
  const float min_hz = 0.01f;
  const float max_hz = 20.0f;
  float hz = min_hz * std::exp(normalized * std::log(max_hz / min_hz));
  return hz / 48000.0f;
}

}  // namespace

extern "C" {

void* tides_create() {
  auto* state = new TidesState();
  state->generator.Init();
  // Fill gate buffer with GATE_FLAG_HIGH for free-running mode
  std::fill(state->gate_buffer, state->gate_buffer + 128, stmlib::GATE_FLAG_HIGH);

  state->smooth_frequency.reset(0.5f);
  state->smooth_shape.reset(0.5f);
  state->smooth_slope.reset(0.5f);
  state->smooth_smoothness.reset(0.5f);
  state->smooth_shift.reset(0.0f);

  return state;
}

void tides_destroy(void* handle) {
  delete static_cast<TidesState*>(handle);
}

void tides_set_mode(void* handle, int mode) {
  auto* state = static_cast<TidesState*>(handle);
  if (!state) return;
  state->ramp_mode = std::max(0, std::min(mode, 2));
}

void tides_set_parameters(void* handle, float frequency, float shape, float slope, float smoothness) {
  auto* state = static_cast<TidesState*>(handle);
  if (!state) return;
  state->smooth_frequency.set(clamp01(frequency));
  state->smooth_shape.set(clamp01(shape));
  state->smooth_slope.set(clamp01(slope));
  state->smooth_smoothness.set(clamp01(smoothness));
}

void tides_set_extended(void* handle, float shift, int output_mode, int range) {
  auto* state = static_cast<TidesState*>(handle);
  if (!state) return;
  state->smooth_shift.set(clamp01(shift));
  state->output_mode = std::max(0, std::min(output_mode, 3));
  state->range = std::max(0, std::min(range, 1));
}

int tides_render(void* handle, float* output, int num_frames) {
  auto* state = static_cast<TidesState*>(handle);
  if (!state || !output || num_frames <= 0) return 0;

  // Smoothing coefficient: ~5ms settling at 48kHz.
  constexpr float kSmoothCoeff = 0.4f;

  const int frames = std::min(num_frames, 128);

  // Advance smoothed parameters toward targets
  state->smooth_frequency.step(kSmoothCoeff);
  state->smooth_shape.step(kSmoothCoeff);
  state->smooth_slope.step(kSmoothCoeff);
  state->smooth_smoothness.step(kSmoothCoeff);
  state->smooth_shift.step(kSmoothCoeff);

  RampMode mode;
  switch (state->ramp_mode) {
    case 0: mode = RAMP_MODE_AD; break;
    case 2: mode = RAMP_MODE_AR; break;
    default: mode = RAMP_MODE_LOOPING; break;
  }

  OutputMode out_mode;
  switch (state->output_mode) {
    case 0: out_mode = tides::OUTPUT_MODE_GATES; break;
    case 2: out_mode = tides::OUTPUT_MODE_SLOPE_PHASE; break;
    case 3: out_mode = tides::OUTPUT_MODE_FREQUENCY; break;
    default: out_mode = OUTPUT_MODE_AMPLITUDE; break;
  }

  Range rng = (state->range == 1) ? tides::RANGE_AUDIO : RANGE_CONTROL;

  float freq = mapFrequency(state->smooth_frequency.current);

  state->generator.Render(
    mode,
    out_mode,
    rng,
    freq,
    state->smooth_slope.current,
    state->smooth_shape.current,
    state->smooth_smoothness.current,
    state->smooth_shift.current,
    state->gate_buffer,
    nullptr,                 // no external ramp
    state->output_buffer,
    frames
  );

  // Extract channel 0 output, scale from Tides range (roughly -5..+8) to -1..+1
  for (int i = 0; i < frames; ++i) {
    float raw = state->output_buffer[i].channel[0];
    // Tides amplitude output range varies by mode. Normalize roughly:
    // In looping mode the output is roughly -5..+5
    // We divide by 5 and clamp to -1..+1
    output[i] = std::max(-1.0f, std::min(1.0f, raw / 5.0f));
  }

  return frames;
}

}
