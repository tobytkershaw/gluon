#!/usr/bin/env bash
set -euo pipefail

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found. Install and activate Emscripten SDK first." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/public/audio"
mkdir -p "$OUT_DIR"

ELEMENTS_CC_SOURCES=$(find "$ROOT_DIR/wasm/elements/dsp" -name '*.cc' | tr '\n' ' ')

emcc \
  "$ROOT_DIR/wasm/gluon_elements.cpp" \
  "$ROOT_DIR/wasm/elements/resources.cc" \
  "$ROOT_DIR/wasm/stmlib/dsp/units.cc" \
  "$ROOT_DIR/wasm/stmlib/dsp/atan.cc" \
  "$ROOT_DIR/wasm/stmlib/utils/random.cc" \
  $ELEMENTS_CC_SOURCES \
  -I"$ROOT_DIR/wasm" \
  -I"$ROOT_DIR/wasm/elements" \
  -I"$ROOT_DIR/wasm/stmlib" \
  -DTEST=1 \
  -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createElementsModule \
  -s ENVIRONMENT=worker \
  -s FILESYSTEM=0 \
  -s NO_EXIT_RUNTIME=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=4194304 \
  -s EXPORTED_FUNCTIONS='["_elements_create","_elements_destroy","_elements_set_model","_elements_set_patch","_elements_set_note","_elements_gate","_elements_render","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o "$OUT_DIR/elements-module.js"

mv "$OUT_DIR/elements-module.wasm" "$OUT_DIR/elements.wasm"
python3 - <<'PY' "$OUT_DIR/elements-module.js"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace('self.location.href', '(globalThis.location && globalThis.location.href) || ""')
path.write_text(text)
PY
printf '\nglobalThis.createElementsModule = createElementsModule;\n' >> "$OUT_DIR/elements-module.js"
node "$ROOT_DIR/scripts/build-elements-worklet.mjs"
