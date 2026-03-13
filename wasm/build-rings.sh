#!/usr/bin/env bash
set -euo pipefail

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found. Install and activate Emscripten SDK first." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/public/audio"
mkdir -p "$OUT_DIR"

RINGS_SOURCES=$(find "$ROOT_DIR/wasm/rings/dsp" -name '*.cc' | tr '\n' ' ')

emcc \
  "$ROOT_DIR/wasm/gluon_rings.cpp" \
  "$ROOT_DIR/wasm/rings/resources.cc" \
  "$ROOT_DIR/wasm/stmlib/dsp/units.cc" \
  "$ROOT_DIR/wasm/stmlib/utils/random.cc" \
  $RINGS_SOURCES \
  -I"$ROOT_DIR/wasm" \
  -I"$ROOT_DIR/wasm/rings" \
  -I"$ROOT_DIR/wasm/stmlib" \
  -DTEST=1 \
  -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createRingsModule \
  -s ENVIRONMENT=worker \
  -s FILESYSTEM=0 \
  -s NO_EXIT_RUNTIME=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=2097152 \
  -s EXPORTED_FUNCTIONS='["_rings_create","_rings_destroy","_rings_set_model","_rings_set_polyphony","_rings_set_patch","_rings_set_note","_rings_set_internal_exciter","_rings_strum","_rings_render","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o "$OUT_DIR/rings-module.js"

mv "$OUT_DIR/rings-module.wasm" "$OUT_DIR/rings.wasm"
python3 - <<'PY' "$OUT_DIR/rings-module.js"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace('self.location.href', '(globalThis.location && globalThis.location.href) || ""')
path.write_text(text)
PY
printf '\nglobalThis.createRingsModule = createRingsModule;\n' >> "$OUT_DIR/rings-module.js"
node "$ROOT_DIR/scripts/build-rings-worklet.mjs"
