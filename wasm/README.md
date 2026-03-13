## WASM Modules

This directory vendors the minimum Mutable Instruments source needed to
build the browser audio modules used by Gluon.

Vendored source:

- `plaits/dsp/**`, `plaits/resources.*`, `plaits/user_data.h`
- `rings/dsp/**`, `rings/resources.*`
- `clouds/dsp/**`, `clouds/resources.*`, `clouds/drivers/debug_pin.h`
- `stmlib/**`

Gluon wraps the upstream DSP with `gluon_plaits.cpp`, which exposes a small C
ABI consumed by the AudioWorklet runtime.

### Model Mapping

Gluon's UI uses model indices `0..15`.

Upstream `plaits::Voice` registers 24 engines, with the original Plaits 16
engines occupying indices `8..23`. The worklet therefore maps:

- Gluon `0..15`
- Plaits `8..23`

### Build

Prerequisite: Emscripten with `emcc` on `PATH`.

```bash
npm run wasm:build
```

`npm run wasm:build` prefers a local `emcc` toolchain and automatically falls
back to Docker when `emcc` is not installed.

To force the containerized path:

```bash
npm run wasm:build:docker
```

The Docker build uses `emscripten/emsdk:4.0.7` by default. Override it with
`EMSCRIPTEN_DOCKER_IMAGE` if you need a different pinned image tag.

This produces:

- `public/audio/plaits-module.js` + `plaits.wasm` + `plaits-worklet.js`
- `public/audio/rings-module.js` + `rings.wasm` + `rings-worklet.js`
- `public/audio/clouds-module.js` + `clouds.wasm` + `clouds-worklet.js`

### Native Reference Audit

Step 1b artifact auditing should compare the worklet against a native render of
the same wrapper. A minimal native path can be built from
`wasm/gluon_plaits.cpp`, `wasm/plaits/resources.cc`, and `wasm/plaits/dsp/*.cc`
with a host C++ compiler instead of `emcc`.

```bash
bash wasm/build-reference.sh
./wasm/bin/reference_render 0 /tmp/plaits-reference.f32
```

Suggested audit scenarios:

- sustained note across multiple render quanta
- rapid timbre and morph sweep
- repeated kick, snare, and hi-hat triggers
- smoke pass across all 16 Gluon models

The browser-side harness should render the same scenarios through the worklet
and compare simple metrics such as RMS, peak value, and buffer-boundary
discontinuities.

### Attribution

Mutable Instruments source (Plaits, Rings, Clouds) is copyright Mutable
Instruments and used under the MIT license. See `wasm/LICENSE.mi-plaits`.
