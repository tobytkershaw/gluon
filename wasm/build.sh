#!/usr/bin/env bash
set -euo pipefail

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found. Install and activate Emscripten SDK first." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/public/audio"
mkdir -p "$OUT_DIR"

PLAITS_SOURCES=$(find "$ROOT_DIR/wasm/plaits/dsp" -name '*.cc' | tr '\n' ' ')

emcc \
  "$ROOT_DIR/wasm/gluon_plaits.cpp" \
  "$ROOT_DIR/wasm/plaits/resources.cc" \
  "$ROOT_DIR/wasm/stmlib/dsp/units.cc" \
  "$ROOT_DIR/wasm/stmlib/utils/random.cc" \
  $PLAITS_SOURCES \
  -I"$ROOT_DIR/wasm" \
  -I"$ROOT_DIR/wasm/plaits" \
  -I"$ROOT_DIR/wasm/stmlib" \
  -DTEST=1 \
  -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createPlaitsModule \
  -s ENVIRONMENT=worker \
  -s FILESYSTEM=0 \
  -s NO_EXIT_RUNTIME=1 \
  -s EXPORTED_FUNCTIONS='["_plaits_create","_plaits_destroy","_plaits_set_model","_plaits_set_patch","_plaits_trigger","_plaits_set_gate","_plaits_render","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o "$OUT_DIR/plaits-module.js"

mv "$OUT_DIR/plaits-module.wasm" "$OUT_DIR/plaits.wasm"
python3 - <<'PY' "$OUT_DIR/plaits-module.js"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace('self.location.href', '(globalThis.location && globalThis.location.href) || ""')
path.write_text(text)
PY
printf '\nglobalThis.createPlaitsModule = createPlaitsModule;\n' >> "$OUT_DIR/plaits-module.js"
node "$ROOT_DIR/scripts/build-plaits-worklet.mjs"
