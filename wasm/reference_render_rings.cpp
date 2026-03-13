#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

extern "C" {
void* plaits_create(float sample_rate);
void plaits_destroy(void* handle);
void plaits_set_model(void* handle, int model_index);
void plaits_set_patch(void* handle, float harmonics, float timbre, float morph, float note);
void plaits_trigger(void* handle, float accent_level);
void plaits_set_gate(void* handle, int open);
int plaits_render(void* handle, float* output, int num_frames);

void* rings_create();
void rings_destroy(void* handle);
void rings_set_model(void* handle, int model_index);
void rings_set_polyphony(void* handle, int polyphony);
void rings_set_patch(void* handle, float structure, float brightness, float damping, float position);
void rings_set_note(void* handle, float tonic, float note);
void rings_set_internal_exciter(void* handle, int enabled);
void rings_strum(void* handle);
int rings_render(void* handle, const float* input, float* output, int num_frames);
}

namespace {

struct Metrics {
  float peak;
  float rms;
  float max_delta;
};

Metrics analyze(const std::vector<float>& samples) {
  Metrics metrics{0.0f, 0.0f, 0.0f};
  if (samples.empty()) return metrics;

  double sum = 0.0;
  float previous = samples.front();
  for (float sample : samples) {
    const float abs_sample = std::fabs(sample);
    metrics.peak = std::max(metrics.peak, abs_sample);
    sum += static_cast<double>(sample) * static_cast<double>(sample);
    metrics.max_delta = std::max(metrics.max_delta, std::fabs(sample - previous));
    previous = sample;
  }
  metrics.rms = static_cast<float>(std::sqrt(sum / static_cast<double>(samples.size())));
  return metrics;
}

}  // namespace

int main(int argc, char** argv) {
  const int sample_rate = 48000;
  const int rings_model = argc > 1 ? std::atoi(argv[1]) : 0;
  const bool use_internal_exciter = argc > 2 && std::string(argv[2]) == "--internal";
  const std::string output_path = argc > 3 ? argv[3] : (argc > 2 && argv[2][0] != '-' ? argv[2] : "");

  // Create Rings
  void* rings = rings_create();
  if (!rings) {
    std::cerr << "failed to create rings instance\n";
    return 1;
  }

  rings_set_model(rings, std::max(0, std::min(rings_model, 5)));
  rings_set_patch(rings, 0.5f, 0.5f, 0.7f, 0.5f);
  rings_set_note(rings, 48.0f, 0.0f);

  const float seconds = 2.0f;
  const int total_frames = static_cast<int>(seconds * sample_rate);
  std::vector<float> output(total_frames);

  if (use_internal_exciter) {
    // Internal exciter mode: no source needed
    rings_set_internal_exciter(rings, 1);
    rings_strum(rings);
    rings_render(rings, nullptr, output.data(), total_frames);
  } else {
    // External exciter mode: use Plaits as source
    void* plaits = plaits_create(static_cast<float>(sample_rate));
    if (!plaits) {
      std::cerr << "failed to create plaits voice for source\n";
      rings_destroy(rings);
      return 1;
    }

    plaits_set_model(plaits, 8);  // virtual-analog
    plaits_set_patch(plaits, 0.5f, 0.5f, 0.5f, 0.47f);
    plaits_trigger(plaits, 0.8f);
    plaits_set_gate(plaits, 1);

    // Render Plaits source
    std::vector<float> source(total_frames);
    plaits_render(plaits, source.data(), total_frames);
    plaits_set_gate(plaits, 0);

    // Feed through Rings
    rings_set_internal_exciter(rings, 0);
    rings_strum(rings);
    rings_render(rings, source.data(), output.data(), total_frames);

    plaits_destroy(plaits);
  }

  const Metrics metrics = analyze(output);

  std::cout << "rings_model=" << rings_model
            << " exciter=" << (use_internal_exciter ? "internal" : "plaits")
            << " frames=" << output.size()
            << " peak=" << metrics.peak
            << " rms=" << metrics.rms
            << " max_delta=" << metrics.max_delta
            << "\n";

  if (!output_path.empty()) {
    std::ofstream out(output_path, std::ios::binary);
    out.write(reinterpret_cast<const char*>(output.data()),
              static_cast<std::streamsize>(output.size() * sizeof(float)));
  }

  rings_destroy(rings);
  return 0;
}
