#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if command -v emcc >/dev/null 2>&1; then
  exec bash "$ROOT_DIR/wasm/build.sh"
fi

if command -v docker >/dev/null 2>&1; then
  exec bash "$ROOT_DIR/scripts/wasm-build-docker.sh"
fi

echo "Neither emcc nor docker is available. Install Emscripten locally or use Docker." >&2
exit 1
