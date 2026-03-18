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
  "$ROOT_DIR/wasm/warps/warps_wrapper.cc" \
  -I"$ROOT_DIR/wasm" \
  -I"$ROOT_DIR/wasm/warps" \
  -DTEST=1 \
  -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createWarpsModule \
  -s ENVIRONMENT=worker \
  -s FILESYSTEM=0 \
  -s NO_EXIT_RUNTIME=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=2097152 \
  -s EXPORTED_FUNCTIONS='["_warps_create","_warps_destroy","_warps_process","_warps_set_patch","_warps_set_model","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o "$OUT_DIR/warps-module.js"

mv "$OUT_DIR/warps-module.wasm" "$OUT_DIR/warps.wasm"
python3 - <<'PY' "$OUT_DIR/warps-module.js"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace('self.location.href', '(globalThis.location && globalThis.location.href) || ""')
path.write_text(text)
PY
printf '\nglobalThis.createWarpsModule = createWarpsModule;\n' >> "$OUT_DIR/warps-module.js"
