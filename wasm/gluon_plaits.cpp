// Thin C ABI wrapper around Mutable Instruments Plaits.
#include <algorithm>
#include <cstdint>
#include <cstring>

#include "plaits/dsp/dsp.h"
#include "plaits/dsp/voice.h"

#define TEST 1
#include "plaits/user_data.h"

#include "stmlib/utils/buffer_allocator.h"

namespace {

using plaits::Modulations;
using plaits::Patch;
using plaits::Voice;
using stmlib::BufferAllocator;

constexpr size_t kVoiceRamSize = 16384;

struct PlaitsVoiceState {
  Voice voice;
  Patch patch;
  Modulations modulations;
  Voice::Frame frames[plaits::kMaxBlockSize];
  uint8_t ram[kVoiceRamSize];
  BufferAllocator allocator;
  int trigger_blocks_remaining;
  float accent_level;
  bool gate_open;
  float sample_rate;

  PlaitsVoiceState() : trigger_blocks_remaining(0), accent_level(0.8f), gate_open(false), sample_rate(48000.0f) {
    std::memset(&patch, 0, sizeof(patch));
    std::memset(&modulations, 0, sizeof(modulations));
  }
};

inline float clamp01(float value) {
  return std::max(0.0f, std::min(1.0f, value));
}

void init_state(PlaitsVoiceState* state, float sample_rate) {
  state->sample_rate = sample_rate;
  state->allocator.Init(state->ram, kVoiceRamSize);
  state->voice.Init(&state->allocator);

  state->patch.note = 60.0f;
  state->patch.harmonics = 0.5f;
  state->patch.timbre = 0.5f;
  state->patch.morph = 0.5f;
  state->patch.frequency_modulation_amount = 0.0f;
  state->patch.timbre_modulation_amount = 0.0f;
  state->patch.morph_modulation_amount = 0.0f;
  state->patch.engine = 8;
  state->patch.decay = 0.5f;
  state->patch.lpg_colour = 0.5f;

  state->modulations.engine = 0.0f;
  state->modulations.note = 0.0f;
  state->modulations.frequency = 0.0f;
  state->modulations.harmonics = 0.0f;
  state->modulations.timbre = 0.0f;
  state->modulations.morph = 0.0f;
  state->modulations.trigger = 0.0f;
  state->modulations.level = 0.8f;
  state->modulations.frequency_patched = false;
  state->modulations.timbre_patched = false;
  state->modulations.morph_patched = false;
  state->modulations.trigger_patched = true;
  state->modulations.level_patched = true;
}

}  // namespace

extern "C" {

void* plaits_create(float sample_rate) {
  auto* state = new PlaitsVoiceState();
  init_state(state, sample_rate);
  return state;
}

void plaits_destroy(void* handle) {
  delete static_cast<PlaitsVoiceState*>(handle);
}

void plaits_set_model(void* handle, int model_index) {
  auto* state = static_cast<PlaitsVoiceState*>(handle);
  if (!state) return;
  state->patch.engine = std::max(0, std::min(model_index, 23));
}

void plaits_set_patch(void* handle, float harmonics, float timbre, float morph, float note) {
  auto* state = static_cast<PlaitsVoiceState*>(handle);
  if (!state) return;
  state->patch.harmonics = clamp01(harmonics);
  state->patch.timbre = clamp01(timbre);
  state->patch.morph = clamp01(morph);
  state->patch.note = clamp01(note) * 127.0f;
}

void plaits_trigger(void* handle, float accent_level) {
  auto* state = static_cast<PlaitsVoiceState*>(handle);
  if (!state) return;
  state->accent_level = std::max(0.0f, accent_level);
  state->trigger_blocks_remaining = 1;
  state->gate_open = true;
}

void plaits_set_gate(void* handle, int open) {
  auto* state = static_cast<PlaitsVoiceState*>(handle);
  if (!state) return;
  state->gate_open = open != 0;
}

int plaits_render(void* handle, float* output, int num_frames) {
  auto* state = static_cast<PlaitsVoiceState*>(handle);
  if (!state || !output || num_frames <= 0) return 0;

  int rendered = 0;
  while (rendered < num_frames) {
    const size_t block = std::min(static_cast<size_t>(num_frames - rendered), plaits::kMaxBlockSize);
    state->modulations.trigger = (state->gate_open || state->trigger_blocks_remaining > 0) ? 1.0f : 0.0f;
    state->modulations.level = state->accent_level;
    state->voice.Render(state->patch, state->modulations, state->frames, block);
    for (size_t i = 0; i < block; ++i) {
      output[rendered + i] = static_cast<float>(state->frames[i].out) / 32768.0f;
    }
    if (state->trigger_blocks_remaining > 0) {
      --state->trigger_blocks_remaining;
    }
    rendered += static_cast<int>(block);
  }

  return rendered;
}

}
