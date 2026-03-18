// Thin C ABI wrapper around Mutable Instruments Beads.
// Beads is the successor to Clouds, providing granular processing, delay, and reverb.
//
// NOTE: This is a stub wrapper with correct API signatures. To build the actual
// WASM module, fetch the Beads DSP source from github.com/pichenettes/eurorack
// (beads/dsp/ directory) and place it alongside this wrapper.

#include <algorithm>
#include <cstdint>
#include <cstring>

namespace {

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

// Beads operates in three quality modes internally.
// We expose three processing modes: granular, delay, reverb.
enum BeadsModel {
  BEADS_MODEL_GRANULAR = 0,
  BEADS_MODEL_DELAY = 1,
  BEADS_MODEL_REVERB = 2,
  BEADS_MODEL_LAST
};

// Tiny DC offset to prevent denormal floating-point numbers in WASM.
static const float DENORMAL_GUARD = 1e-25f;

inline float clamp01(float value) {
  return std::max(0.0f, std::min(1.0f, value));
}

struct BeadsState {
  float sample_rate;
  BeadsModel model;

  // Smoothed parameters
  SmoothedParam smooth_time;
  SmoothedParam smooth_density;
  SmoothedParam smooth_texture;
  SmoothedParam smooth_position;
  SmoothedParam smooth_pitch;
  SmoothedParam smooth_dry_wet;

  // TODO: Replace with actual Beads DSP processor once MI source is fetched.
  // For now this is a pass-through stub.

  BeadsState(float sr) : sample_rate(sr), model(BEADS_MODEL_GRANULAR) {
    smooth_time.reset(0.5f);
    smooth_density.reset(0.5f);
    smooth_texture.reset(0.5f);
    smooth_position.reset(0.5f);
    smooth_pitch.reset(0.5f);
    smooth_dry_wet.reset(0.5f);
  }
};

}  // namespace

extern "C" {

void* beads_create(float sample_rate) {
  auto* state = new BeadsState(sample_rate);
  return state;
}

void beads_destroy(void* handle) {
  delete static_cast<BeadsState*>(handle);
}

void beads_set_model(void* handle, int model_index) {
  auto* state = static_cast<BeadsState*>(handle);
  if (!state) return;
  int clamped = std::max(0, std::min(model_index, static_cast<int>(BEADS_MODEL_LAST) - 1));
  state->model = static_cast<BeadsModel>(clamped);
}

void beads_set_patch(void* handle, float time, float density, float texture,
                     float position, float pitch, float dry_wet) {
  auto* state = static_cast<BeadsState*>(handle);
  if (!state) return;
  state->smooth_time.set(clamp01(time));
  state->smooth_density.set(clamp01(density));
  state->smooth_texture.set(clamp01(texture));
  state->smooth_position.set(clamp01(position));
  state->smooth_pitch.set(clamp01(pitch));
  state->smooth_dry_wet.set(clamp01(dry_wet));
}

int beads_process(void* handle, const float* input,
                  float* out_left, float* out_right, int num_frames) {
  auto* state = static_cast<BeadsState*>(handle);
  if (!state || !out_left || !out_right || num_frames <= 0) return 0;

  constexpr float kSmoothCoeff = 0.4f;

  // Advance smoothed parameters
  state->smooth_time.step(kSmoothCoeff);
  state->smooth_density.step(kSmoothCoeff);
  state->smooth_texture.step(kSmoothCoeff);
  state->smooth_position.step(kSmoothCoeff);
  state->smooth_pitch.step(kSmoothCoeff);
  state->smooth_dry_wet.step(kSmoothCoeff);

  const float dry_wet = state->smooth_dry_wet.current;

  // TODO: Replace with actual Beads DSP processing.
  // Stub: pass-through with dry/wet mix (dry when dry_wet=0, silence when dry_wet=1).
  for (int i = 0; i < num_frames; ++i) {
    float sample = (input ? input[i] : 0.0f) + DENORMAL_GUARD;
    float dry = sample * (1.0f - dry_wet);
    // Wet would come from the DSP processor — stub outputs silence for wet path
    out_left[i] = dry;
    out_right[i] = dry;
  }

  return num_frames;
}

}
