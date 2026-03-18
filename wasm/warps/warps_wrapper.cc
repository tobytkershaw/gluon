// wasm/warps/warps_wrapper.cc
// Thin C wrapper around Mutable Instruments Warps DSP.
//
// This is a stub implementation. To use the real Warps DSP:
// 1. Clone https://github.com/pichenettes/eurorack
// 2. Copy warps/dsp/ into wasm/warps/dsp/
// 3. Update build-warps.sh to compile the real sources
//
// The stub provides correct API signatures so the build pipeline and
// worklet integration can be developed and tested independently.

#include <cstdlib>
#include <cstring>
#include <cmath>

struct WarpsInstance {
  float sample_rate;
  int model;
  float algorithm;
  float timbre;
  float level;
};

extern "C" {

void* warps_create(float sample_rate) {
  WarpsInstance* instance = (WarpsInstance*)malloc(sizeof(WarpsInstance));
  instance->sample_rate = sample_rate;
  instance->model = 0;
  instance->algorithm = 0.5f;
  instance->timbre = 0.5f;
  instance->level = 0.5f;
  return instance;
}

void warps_destroy(void* ptr) {
  free(ptr);
}

void warps_set_patch(void* ptr, float algorithm, float timbre, float level) {
  WarpsInstance* instance = (WarpsInstance*)ptr;
  instance->algorithm = algorithm;
  instance->timbre = timbre;
  instance->level = level;
}

void warps_set_model(void* ptr, int model) {
  WarpsInstance* instance = (WarpsInstance*)ptr;
  instance->model = model;
}

void warps_process(void* ptr, const float* input, float* out_left, float* out_right, int frames) {
  WarpsInstance* instance = (WarpsInstance*)ptr;

  // Stub: pass through input to both outputs with minimal processing
  // Real implementation would use MI Warps DSP
  for (int i = 0; i < frames; i++) {
    float sample = input[i];

    switch (instance->model) {
      case 0: // Crossfade
        out_left[i] = sample;
        out_right[i] = sample;
        break;
      case 1: // Fold
        {
          float gain = 1.0f + instance->algorithm * 7.0f;
          float folded = sample * gain;
          if (folded > 1.0f) folded = 2.0f - folded;
          if (folded < -1.0f) folded = -2.0f - folded;
          out_left[i] = folded;
          out_right[i] = folded;
        }
        break;
      case 2: // Ring mod
        out_left[i] = sample * instance->level;
        out_right[i] = sample * instance->level;
        break;
      case 3: // Frequency shift
        out_left[i] = sample;
        out_right[i] = sample;
        break;
      default:
        out_left[i] = sample;
        out_right[i] = sample;
    }
  }
}

} // extern "C"
