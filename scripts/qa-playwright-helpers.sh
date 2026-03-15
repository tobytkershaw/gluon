#!/usr/bin/env bash
# Shared helpers for Playwright QA scripts.
#
# Maintenance note:
# This runner intentionally uses the existing Playwright CLI wrapper rather than
# a separate browser test framework, but that makes it coupled to two unstable
# surfaces:
# 1. accessibility snapshot formatting, which several selector helpers parse
# 2. the CLI wrapper's markdown-style output, which eval_js parses to recover
#    JavaScript results
# If the Playwright CLI snapshot or result format changes, the helper functions
# in this file are the first place to check.
#
# Required variables (set by the sourcing script):
#   SESSION_NAME  — Playwright session name
#   PWCLI         — path to Playwright CLI wrapper
#   PW_TIMEOUT    — timeout in seconds
#   OUT_DIR       — output directory for artifacts

run_pw() {
  python3 - "$SESSION_NAME" "$PWCLI" "$PW_TIMEOUT" "$@" <<'PY'
import os
import subprocess
import sys

session_name = sys.argv[1]
pwcli = sys.argv[2]
timeout_s = float(sys.argv[3])
args = sys.argv[4:]

env = os.environ.copy()
env["PLAYWRIGHT_CLI_SESSION"] = session_name

try:
    completed = subprocess.run([pwcli, *args], env=env, timeout=timeout_s)
    raise SystemExit(completed.returncode)
except subprocess.TimeoutExpired:
    print(f"Playwright command timed out after {timeout_s:.0f}s: {args}", file=sys.stderr)
    raise SystemExit(124)
PY
}

eval_js() {
  local script="$1"
  local ref="${2:-}"
  local out_file
  out_file="$(mktemp)"
  if [[ -n "$ref" ]]; then
    run_pw eval "$script" "$ref" >"$out_file" 2>&1
  else
    run_pw eval "$script" >"$out_file" 2>&1
  fi
  python3 - "$out_file" <<'PY'
import re
import sys

path = sys.argv[1]
text = open(path, 'r', encoding='utf-8').read()
m = re.search(r'^### Result\s*\n(.*?)\n### Ran Playwright code', text, re.S | re.M)
if not m:
    raise SystemExit(1)
result = m.group(1).strip()
print(result)
PY
  rm -f "$out_file"
}

snapshot_page() {
  local name="$1"
  local out_file="$OUT_DIR/${name}-snapshot.txt"
  run_pw snapshot >"$out_file" 2>&1
  local snapshot_file
  snapshot_file="$(perl -ne 'if (/\[Snapshot\]\(([^)]+)\)/) { print "$1\n"; exit }' "$out_file")"
  if [[ -n "$snapshot_file" ]]; then
    cp "$snapshot_file" "$OUT_DIR/${name}.yml"
  fi
}

screenshot_page() {
  local name="$1"
  local out_file="$OUT_DIR/${name}-screenshot.txt"
  run_pw screenshot >"$out_file" 2>&1
  local screenshot_file
  screenshot_file="$(perl -ne 'if (/\[Screenshot of viewport\]\(([^)]+)\)/) { print "$1\n"; exit }' "$out_file")"
  if [[ -n "$screenshot_file" ]]; then
    cp "$screenshot_file" "$OUT_DIR/${name}.png"
  fi
}

capture_console() {
  local name="$1"
  local out_file="$OUT_DIR/console-${name}.log"
  run_pw console >"$out_file" 2>&1 || true
  local console_file
  console_file="$(perl -ne 'if (/\[Console\]\(([^)]+)\)/) { print "$1\n"; exit }' "$out_file")"
  if [[ -n "$console_file" && -f "$console_file" ]]; then
    cp "$console_file" "$OUT_DIR/console-${name}.txt"
  fi
}

capture_network() {
  local name="$1"
  local out_file="$OUT_DIR/network-${name}.log"
  run_pw network >"$out_file" 2>&1 || true
  local network_file
  network_file="$(perl -ne 'if (/\[Network\]\(([^)]+)\)/) { print "$1\n"; exit }' "$out_file")"
  if [[ -n "$network_file" && -f "$network_file" ]]; then
    cp "$network_file" "$OUT_DIR/network-${name}.txt"
  fi
}

current_snapshot_copy() {
  ls -t "$OUT_DIR"/*.yml 2>/dev/null | head -n 1
}

button_ref() {
  local label="$1"
  local file
  file="$(current_snapshot_copy)"
  perl -ne '
    if (/button "\Q'"$label"'\E"(?: \[[^\]]+\])* \[ref=(e\d+)\]/) {
      print "$1\n";
      exit;
    }
  ' "$file"
}

nth_button_ref() {
  local label="$1"
  local index="${2:-1}"
  local file
  file="$(current_snapshot_copy)"
  perl -ne '
    if (/button "\Q'"$label"'\E"(?: \[[^\]]+\])* \[ref=(e\d+)\]/) {
      push @refs, $1;
    }
    END {
      my $idx = '"$index"' - 1;
      if ($idx >= 0 && $idx <= $#refs) {
        print $refs[$idx], "\n";
      }
    }
  ' "$file"
}

textbox_ref() {
  local label="$1"
  local file
  file="$(current_snapshot_copy)"
  rg -o "textbox \"$label\" \\[ref=(e[0-9]+)\\]" "$file" -r '$1' | head -n 1
}

spinbutton_ref() {
  local file
  file="$(current_snapshot_copy)"
  perl -ne '
    if (/spinbutton(?: \[[^\]]+\])* \[ref=(e\d+)\]/) {
      print "$1\n";
      exit;
    }
  ' "$file"
}

voice_card_ref() {
  local label="$1"
  local file
  file="$(current_snapshot_copy)"
  perl -ne '
    if (/generic \[ref=(e\d+)\] \[cursor=pointer\]:/) {
      $parent = $1;
      next;
    }
    if (defined $parent && /: \Q'"$label"'\E$/) {
      print "$parent\n";
      exit;
    }
  ' "$file"
}

step_button_ref() {
  local label="$1"
  local file
  file="$(current_snapshot_copy)"
  perl -ne '
    if (/generic .*: Step Grid$/) {
      $in_grid = 1;
      next;
    }
    if ($in_grid && /generic .*: Len$/) {
      $in_grid = 0;
    }
    if ($in_grid && /button "\Q'"$label"'\E"(?: \[[^\]]+\])* \[ref=(e\d+)\]/) {
      print "$1\n";
      exit;
    }
  ' "$file"
}

slider_ref() {
  local label="$1"
  local file
  file="$(current_snapshot_copy)"
  perl -ne '
    if (/generic \[ref=(e\d+)\]:$/) {
      $container = $1;
      $matched = 0;
      next;
    }
    if (defined $container && /generic \[ref=e\d+\]: \Q'"$label"'\E$/) {
      $matched = 1;
      next;
    }
    if ($matched && /slider(?: \[[^\]]+\])* \[ref=(e\d+)\]/) {
      print "$1\n";
      exit;
    }
  ' "$file"
}

drag_slider_to_fraction() {
  local ref="$1"
  local frac="$2"
  local rect_json
  rect_json="$(eval_js 'el => JSON.stringify({left: el.getBoundingClientRect().left, top: el.getBoundingClientRect().top, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height})' "$ref" | tail -n 1)"
  python3 - "$rect_json" "$PWCLI" "$SESSION_NAME" "$frac" <<'PY'
import json
import os
import subprocess
import sys

rect = json.loads(sys.argv[1])
if isinstance(rect, str):
    rect = json.loads(rect)
pwcli = sys.argv[2]
session = sys.argv[3]
frac = float(sys.argv[4])
x = rect["left"] + rect["width"] * frac
y = rect["top"] + rect["height"] / 2
env = os.environ.copy()
env["PLAYWRIGHT_CLI_SESSION"] = session
subprocess.run([pwcli, "mousemove", str(int(x)), str(int(y))], env=env, check=True)
subprocess.run([pwcli, "mousedown", "left"], env=env, check=True)
subprocess.run([pwcli, "mousemove", str(int(x)), str(int(y))], env=env, check=True)
subprocess.run([pwcli, "mouseup", "left"], env=env, check=True)
PY
}

snapshot_contains() {
  local needle="$1"
  local file
  file="$(current_snapshot_copy)"
  rg -Fq "$needle" "$file"
}

qa_anchor_ref() {
  local ref
  ref="$(button_ref "Tracker")"
  if [[ -n "$ref" ]]; then
    printf '%s\n' "$ref"
    return 0
  fi
  ref="$(button_ref "Surface")"
  if [[ -n "$ref" ]]; then
    printf '%s\n' "$ref"
    return 0
  fi
  ref="$(textbox_ref "Describe what you want...")"
  if [[ -n "$ref" ]]; then
    printf '%s\n' "$ref"
    return 0
  fi
  return 1
}

clear_trace() {
  local ref
  ref="$(qa_anchor_ref)"
  eval_js 'el => {
    window.__gluonQaAudioTrace?.clear?.();
    return "ok";
  }' "$ref" >/dev/null
}

record_result() {
  local scenario="$1"
  local result="$2"
  local notes="$3"
  printf '%s\t%s\t%s\n' "$scenario" "$result" "$notes" >>"$OUT_DIR/results.tsv"
}

click_button_by_label() {
  local label="$1"
  local ref
  ref="$(button_ref "$label")"
  if [[ -z "$ref" ]]; then
    echo "Missing button ref for $label" >&2
    return 1
  fi
  run_pw click "$ref" >/dev/null 2>&1
}

click_button_by_title() {
  local title="$1"
  local ref
  ref="$(qa_anchor_ref)"
  local script
  script="$(python3 - "$title" <<'PY'
import json
import sys

title = sys.argv[1]
print(f"""el => {{
  const target = [...el.ownerDocument.querySelectorAll('button')].find((button) => (button.getAttribute('title') || '') === {json.dumps(title)});
  if (!target) return 'missing';
  target.click();
  return 'ok';
}}""")
PY
)"
  local result
  result="$(eval_js "$script" "$ref" | tail -n 1 | tr -d '"')"
  [[ "$result" == "ok" ]]
}

click_view_button() {
  local label="$1"
  case "$label" in
    Chat) return 0 ;;
    Inst) label="Surface" ;;
    Track) label="Tracker" ;;
  esac
  click_button_by_label "$label"
}

click_voice_by_label() {
  local label="$1"
  local ref
  ref="$(voice_card_ref "$label")"
  if [[ -z "$ref" ]]; then
    echo "Missing voice card ref for $label" >&2
    return 1
  fi
  run_pw click "$ref" >/dev/null 2>&1
}

submit_ai_prompt() {
  local prompt="$1"
  local prefix="$2"

  snapshot_page "${prefix}-before"

  if ! snapshot_contains "API Connected"; then
    record_result "$(echo "$prefix" | tr '-' '_')" "blocked" "App UI does not show API Connected."
    return 2
  fi

  local input_ref
  input_ref="$(textbox_ref "Describe what you want...")"
  if [[ -z "$input_ref" ]]; then
    echo "Chat input not found for AI prompt: $prompt" >&2
    return 1
  fi

  run_pw fill "$input_ref" "$prompt" >/dev/null 2>&1
  snapshot_page "${prefix}-filled"
  run_pw click "$input_ref" >/dev/null 2>&1
  run_pw press Enter >/dev/null 2>&1

  local attempt max_attempts
  max_attempts="${AI_SETTLE_MAX_ATTEMPTS:-6}"
  for attempt in $(seq 1 "$max_attempts"); do
    sleep 2
    snapshot_page "${prefix}-after-${attempt}"
    if snapshot_contains "AI" && snapshot_contains "YOU" && ! snapshot_contains "Thinking..."; then
      return 0
    fi
  done

  return 1
}
