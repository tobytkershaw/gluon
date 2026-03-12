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

void render_note(void* handle, std::vector<float>& output, int sample_rate, float seconds, bool accent) {
  const int total_frames = static_cast<int>(seconds * sample_rate);
  output.resize(total_frames);
  plaits_trigger(handle, accent ? 1.0f : 0.8f);
  plaits_set_gate(handle, 1);
  const int rendered = plaits_render(handle, output.data(), total_frames);
  output.resize(rendered);
  plaits_set_gate(handle, 0);
}

}  // namespace

int main(int argc, char** argv) {
  const int sample_rate = 48000;
  const int gluon_model = argc > 1 ? std::atoi(argv[1]) : 0;
  const int plaits_model = std::max(0, std::min(gluon_model, 15)) + 8;
  const std::string output_path = argc > 2 ? argv[2] : "";

  void* handle = plaits_create(static_cast<float>(sample_rate));
  if (!handle) {
    std::cerr << "failed to create plaits voice\n";
    return 1;
  }

  plaits_set_model(handle, plaits_model);
  plaits_set_patch(handle, 0.5f, 0.5f, 0.5f, 0.47f);

  std::vector<float> buffer;
  render_note(handle, buffer, sample_rate, 1.5f, false);
  const Metrics metrics = analyze(buffer);

  std::cout << "model=" << gluon_model
            << " frames=" << buffer.size()
            << " peak=" << metrics.peak
            << " rms=" << metrics.rms
            << " max_delta=" << metrics.max_delta
            << "\n";

  if (!output_path.empty()) {
    std::ofstream out(output_path, std::ios::binary);
    out.write(reinterpret_cast<const char*>(buffer.data()), static_cast<std::streamsize>(buffer.size() * sizeof(float)));
  }

  plaits_destroy(handle);
  return 0;
}
