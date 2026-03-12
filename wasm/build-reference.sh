#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/wasm/bin"
mkdir -p "$OUT_DIR"

PLAITS_SOURCES=$(find "$ROOT_DIR/wasm/plaits/dsp" -name '*.cc' | tr '\n' ' ')

c++ -std=c++17 -O3 \
  "$ROOT_DIR/wasm/gluon_plaits.cpp" \
  "$ROOT_DIR/wasm/reference_render.cpp" \
  "$ROOT_DIR/wasm/plaits/resources.cc" \
  "$ROOT_DIR/wasm/stmlib/dsp/units.cc" \
  "$ROOT_DIR/wasm/stmlib/utils/random.cc" \
  $PLAITS_SOURCES \
  -I"$ROOT_DIR/wasm" \
  -I"$ROOT_DIR/wasm/plaits" \
  -I"$ROOT_DIR/wasm/stmlib" \
  -DTEST=1 \
  -o "$OUT_DIR/reference_render"

echo "Built $OUT_DIR/reference_render"
