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

struct TidesState {
  PolySlopeGenerator generator;
  PolySlopeGenerator::OutputSample output_buffer[128];
  stmlib::GateFlags gate_buffer[128];

  // Parameters (normalized 0-1)
  float frequency;
  float shape;
  float slope;
  float smoothness;

  // Mode: 0=AD, 1=Looping, 2=AR
  int ramp_mode;

  TidesState() : frequency(0.5f), shape(0.5f), slope(0.5f), smoothness(0.5f), ramp_mode(1) {}
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
  state->frequency = clamp01(frequency);
  state->shape = clamp01(shape);
  state->slope = clamp01(slope);
  state->smoothness = clamp01(smoothness);
}

int tides_render(void* handle, float* output, int num_frames) {
  auto* state = static_cast<TidesState*>(handle);
  if (!state || !output || num_frames <= 0) return 0;

  const int frames = std::min(num_frames, 128);

  RampMode mode;
  switch (state->ramp_mode) {
    case 0: mode = RAMP_MODE_AD; break;
    case 2: mode = RAMP_MODE_AR; break;
    default: mode = RAMP_MODE_LOOPING; break;
  }

  float freq = mapFrequency(state->frequency);

  state->generator.Render(
    mode,
    OUTPUT_MODE_AMPLITUDE,   // Use amplitude output — single shaped waveform
    RANGE_CONTROL,           // Control rate range (LFO, not audio oscillator)
    freq,
    state->slope,            // pulse width / slope
    state->shape,            // waveshape
    state->smoothness,
    0.0f,                    // shift (fixed at center — no multi-channel spread)
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
