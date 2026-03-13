#!/usr/bin/env bash
set -euo pipefail

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found. Install and activate Emscripten SDK first." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/public/audio"
mkdir -p "$OUT_DIR"

CLOUDS_CC_SOURCES=$(find "$ROOT_DIR/wasm/clouds/dsp" -name '*.cc' | tr '\n' ' ')

emcc \
  "$ROOT_DIR/wasm/gluon_clouds.cpp" \
  "$ROOT_DIR/wasm/clouds/resources.cc" \
  "$ROOT_DIR/wasm/stmlib/dsp/units.cc" \
  "$ROOT_DIR/wasm/stmlib/utils/random.cc" \
  $CLOUDS_CC_SOURCES \
  -I"$ROOT_DIR/wasm" \
  -I"$ROOT_DIR/wasm/clouds" \
  -I"$ROOT_DIR/wasm/stmlib" \
  -DTEST=1 \
  -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createCloudsModule \
  -s ENVIRONMENT=worker \
  -s FILESYSTEM=0 \
  -s NO_EXIT_RUNTIME=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=8388608 \
  -s EXPORTED_FUNCTIONS='["_clouds_create","_clouds_destroy","_clouds_set_mode","_clouds_set_parameters","_clouds_set_freeze","_clouds_render","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o "$OUT_DIR/clouds-module.js"

mv "$OUT_DIR/clouds-module.wasm" "$OUT_DIR/clouds.wasm"
python3 - <<'PY' "$OUT_DIR/clouds-module.js"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace('self.location.href', '(globalThis.location && globalThis.location.href) || ""')
path.write_text(text)
PY
printf '\nglobalThis.createCloudsModule = createCloudsModule;\n' >> "$OUT_DIR/clouds-module.js"
node "$ROOT_DIR/scripts/build-clouds-worklet.mjs"
