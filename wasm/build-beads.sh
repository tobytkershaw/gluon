#!/usr/bin/env bash
set -euo pipefail

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found. Install and activate Emscripten SDK first." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/public/audio"
mkdir -p "$OUT_DIR"

# When MI Beads source is available, uncomment:
# BEADS_CC_SOURCES=$(find "$ROOT_DIR/wasm/beads/dsp" -name '*.cc' | tr '\n' ' ')

emcc \
  "$ROOT_DIR/wasm/beads/beads_wrapper.cc" \
  -I"$ROOT_DIR/wasm" \
  -I"$ROOT_DIR/wasm/beads" \
  -I"$ROOT_DIR/wasm/stmlib" \
  -DTEST=1 \
  -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createBeadsModule \
  -s ENVIRONMENT=worker \
  -s FILESYSTEM=0 \
  -s NO_EXIT_RUNTIME=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=8388608 \
  -s EXPORTED_FUNCTIONS='["_beads_create","_beads_destroy","_beads_set_model","_beads_set_patch","_beads_process","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o "$OUT_DIR/beads-module.js"

mv "$OUT_DIR/beads-module.wasm" "$OUT_DIR/beads.wasm"
python3 - <<'PY' "$OUT_DIR/beads-module.js"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace('self.location.href', '(globalThis.location && globalThis.location.href) || ""')
path.write_text(text)
PY
printf '\nglobalThis.createBeadsModule = createBeadsModule;\n' >> "$OUT_DIR/beads-module.js"
node "$ROOT_DIR/scripts/build-beads-worklet.mjs"
