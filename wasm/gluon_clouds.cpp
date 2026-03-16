// Thin C ABI wrapper around Mutable Instruments Clouds.
#include <algorithm>
#include <cstdint>
#include <cstring>

#include "clouds/dsp/granular_processor.h"

namespace {

using clouds::GranularProcessor;
using clouds::PlaybackMode;
using clouds::ShortFrame;
using clouds::kMaxBlockSize;

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

// Buffer sizes for Clouds DSP.
// Large buffer: sample recording memory (stereo 16-bit at 32kHz).
// Small buffer: workspace for spectral FFT and FX.
static constexpr size_t kLargeBufferSize = 4 * 1024 * 1024;  // 4MB
static constexpr size_t kSmallBufferSize = 65536;             // 64KB

struct CloudsState {
  GranularProcessor processor;

  uint8_t large_buffer[kLargeBufferSize];
  uint8_t small_buffer[kSmallBufferSize];

  // Smoothed parameters
  SmoothedParam smooth_position;
  SmoothedParam smooth_size;
  SmoothedParam smooth_density;
  SmoothedParam smooth_feedback;
  SmoothedParam smooth_texture;
  SmoothedParam smooth_pitch;
  SmoothedParam smooth_dry_wet;
  SmoothedParam smooth_stereo_spread;
  SmoothedParam smooth_reverb;

  CloudsState() {
    std::memset(large_buffer, 0, sizeof(large_buffer));
    std::memset(small_buffer, 0, sizeof(small_buffer));
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

void* clouds_create() {
  auto* state = new CloudsState();

  state->processor.Init(
    state->large_buffer, kLargeBufferSize,
    state->small_buffer, kSmallBufferSize);
  state->processor.set_playback_mode(clouds::PLAYBACK_MODE_GRANULAR);
  state->processor.set_quality(0);  // stereo, high fidelity
  state->processor.set_bypass(false);

  auto* params = state->processor.mutable_parameters();
  params->position = 0.5f;
  params->size = 0.5f;
  params->density = 0.5f;
  params->texture = 0.5f;
  params->dry_wet = 0.5f;
  params->feedback = 0.0f;
  params->reverb = 0.0f;
  params->pitch = 0.0f;
  params->stereo_spread = 0.0f;
  params->freeze = false;
  params->trigger = false;
  params->gate = false;

  state->smooth_position.reset(0.5f);
  state->smooth_size.reset(0.5f);
  state->smooth_density.reset(0.5f);
  state->smooth_feedback.reset(0.0f);
  state->smooth_texture.reset(0.5f);
  state->smooth_pitch.reset(0.5f);
  state->smooth_dry_wet.reset(0.5f);
  state->smooth_stereo_spread.reset(0.0f);
  state->smooth_reverb.reset(0.0f);

  return state;
}

void clouds_destroy(void* handle) {
  delete static_cast<CloudsState*>(handle);
}

void clouds_set_mode(void* handle, int mode_index) {
  auto* state = static_cast<CloudsState*>(handle);
  if (!state) return;
  int clamped = std::max(0, std::min(mode_index, static_cast<int>(clouds::PLAYBACK_MODE_LAST) - 1));
  state->processor.set_playback_mode(static_cast<PlaybackMode>(clamped));
}

void clouds_set_parameters(void* handle, float position, float size, float density, float feedback) {
  auto* state = static_cast<CloudsState*>(handle);
  if (!state) return;
  state->smooth_position.set(clamp01(position));
  state->smooth_size.set(clamp01(size));
  state->smooth_density.set(clamp01(density));
  state->smooth_feedback.set(clamp01(feedback));
}

void clouds_set_extended(void* handle, float texture, float pitch,
                         float dry_wet, float stereo_spread, float reverb) {
  auto* state = static_cast<CloudsState*>(handle);
  if (!state) return;
  state->smooth_texture.set(clamp01(texture));
  // pitch is 0-1 normalized, map to -48..+48 semitones inside render
  state->smooth_pitch.set(clamp01(pitch));
  state->smooth_dry_wet.set(clamp01(dry_wet));
  state->smooth_stereo_spread.set(clamp01(stereo_spread));
  state->smooth_reverb.set(clamp01(reverb));
}

void clouds_set_freeze(void* handle, int freeze) {
  auto* state = static_cast<CloudsState*>(handle);
  if (!state) return;
  state->processor.set_freeze(freeze != 0);
}

int clouds_render(void* handle, const float* input, float* output, int num_frames) {
  auto* state = static_cast<CloudsState*>(handle);
  if (!state || !output || num_frames <= 0) return 0;

  constexpr float kSmoothCoeff = 0.4f;
  int rendered = 0;

  while (rendered < num_frames) {
    const size_t block = std::min(static_cast<size_t>(num_frames - rendered), kMaxBlockSize);

    // Advance smoothed parameters
    state->smooth_position.step(kSmoothCoeff);
    state->smooth_size.step(kSmoothCoeff);
    state->smooth_density.step(kSmoothCoeff);
    state->smooth_feedback.step(kSmoothCoeff);
    state->smooth_texture.step(kSmoothCoeff);
    state->smooth_pitch.step(kSmoothCoeff);
    state->smooth_dry_wet.step(kSmoothCoeff);
    state->smooth_stereo_spread.step(kSmoothCoeff);
    state->smooth_reverb.step(kSmoothCoeff);

    auto* params = state->processor.mutable_parameters();
    params->position = state->smooth_position.current;
    params->size = state->smooth_size.current;
    params->density = state->smooth_density.current;
    params->feedback = state->smooth_feedback.current;
    params->texture = state->smooth_texture.current;
    // Map normalized 0-1 pitch to -48..+48 semitones
    params->pitch = (state->smooth_pitch.current - 0.5f) * 96.0f;
    params->dry_wet = state->smooth_dry_wet.current;
    params->stereo_spread = state->smooth_stereo_spread.current;
    params->reverb = state->smooth_reverb.current;

    // Prepare must be called before each Process
    state->processor.Prepare();

    // Convert float input to ShortFrame (int16 stereo), adding denormal guard
    ShortFrame in_frames[kMaxBlockSize];
    ShortFrame out_frames[kMaxBlockSize];
    for (size_t i = 0; i < block; ++i) {
      float sample = (input ? input[rendered + i] : 0.0f) + DENORMAL_GUARD;
      // Clamp to prevent int16 overflow
      sample = std::max(-1.0f, std::min(1.0f, sample));
      int16_t s = static_cast<int16_t>(sample * 32767.0f);
      in_frames[i].l = s;
      in_frames[i].r = s;
    }

    state->processor.Process(in_frames, out_frames, block);

    // Convert ShortFrame output back to float (mono mixdown)
    for (size_t i = 0; i < block; ++i) {
      float l = static_cast<float>(out_frames[i].l) / 32768.0f;
      float r = static_cast<float>(out_frames[i].r) / 32768.0f;
      output[rendered + i] = (l + r) * 0.5f;
    }

    rendered += static_cast<int>(block);
  }

  return rendered;
}

}
