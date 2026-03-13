#!/usr/bin/env bash
set -euo pipefail

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found. Install and activate Emscripten SDK first." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/public/audio"
mkdir -p "$OUT_DIR"

emcc \
  "$ROOT_DIR/wasm/gluon_tides.cpp" \
  "$ROOT_DIR/wasm/tides2/poly_slope_generator.cc" \
  "$ROOT_DIR/wasm/tides2/resources.cc" \
  "$ROOT_DIR/wasm/stmlib/dsp/units.cc" \
  "$ROOT_DIR/wasm/stmlib/utils/random.cc" \
  -I"$ROOT_DIR/wasm" \
  -I"$ROOT_DIR/wasm/tides2" \
  -I"$ROOT_DIR/wasm/stmlib" \
  -DTEST=1 \
  -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createTidesModule \
  -s ENVIRONMENT=worker \
  -s FILESYSTEM=0 \
  -s NO_EXIT_RUNTIME=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=2097152 \
  -s EXPORTED_FUNCTIONS='["_tides_create","_tides_destroy","_tides_set_mode","_tides_set_parameters","_tides_render","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o "$OUT_DIR/tides-module.js"

mv "$OUT_DIR/tides-module.wasm" "$OUT_DIR/tides.wasm"
python3 - <<'PY' "$OUT_DIR/tides-module.js"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace('self.location.href', '(globalThis.location && globalThis.location.href) || ""')
path.write_text(text)
PY
printf '\nglobalThis.createTidesModule = createTidesModule;\n' >> "$OUT_DIR/tides-module.js"
node "$ROOT_DIR/scripts/build-tides-worklet.mjs"
