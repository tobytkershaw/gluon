#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${EMSCRIPTEN_DOCKER_IMAGE:-emscripten/emsdk:4.0.7}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found on PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running." >&2
  exit 1
fi

docker run --rm \
  -v "$ROOT_DIR:/workspace" \
  -w /workspace \
  "$IMAGE" \
  bash wasm/build.sh
