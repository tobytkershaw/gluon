#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${QA_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT_DIR="${QA_OUT_DIR:-$ROOT_DIR/output/playwright/$RUN_ID/preflight}"
mkdir -p "$OUT_DIR"

run_step() {
  local name="$1"
  shift
  local log_file="$OUT_DIR/${name}.log"

  echo
  echo "==> $name"
  if "$@" >"$log_file" 2>&1; then
    echo "PASS  $name"
  else
    echo "FAIL  $name (see $log_file)" >&2
    tail -n 40 "$log_file" >&2 || true
    return 1
  fi
}

echo "QA preflight run id: $RUN_ID"
echo "Artifacts: $OUT_DIR"

run_step typecheck npx tsc --noEmit
run_step vitest npx vitest run
run_step build npm run build

echo
echo "==> lint (informational)"
if npm run lint >"$OUT_DIR/lint.log" 2>&1; then
  echo "PASS  lint"
else
  echo "WARN  lint failed (see $OUT_DIR/lint.log)"
fi

cat >"$OUT_DIR/summary.txt" <<EOF
run_id=$RUN_ID
root_dir=$ROOT_DIR
typecheck=pass
vitest=pass
build=pass
lint_log=$OUT_DIR/lint.log
EOF

echo
echo "Preflight complete."
