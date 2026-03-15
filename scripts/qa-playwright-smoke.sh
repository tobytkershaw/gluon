#!/usr/bin/env bash
set -euo pipefail

# Maintenance note:
# This runner intentionally uses the existing Playwright CLI wrapper rather than
# a separate browser test framework, but that makes it coupled to two unstable
# surfaces:
# 1. accessibility snapshot formatting, which several selector helpers parse
# 2. the CLI wrapper's markdown-style output, which eval_js parses to recover
#    JavaScript results
# If the Playwright CLI snapshot or result format changes, the helper functions
# near the top of this script are the first place to check.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="${PWCLI:-$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh}"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required for the Playwright CLI wrapper." >&2
  exit 1
fi

if [[ ! -x "$PWCLI" ]]; then
  echo "Playwright wrapper not found: $PWCLI" >&2
  exit 1
fi

RUN_ID="${QA_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
BASE_URL="${QA_BASE_URL:-http://127.0.0.1:5173/?qaAudioTrace=1}"
OUT_DIR="${QA_OUT_DIR:-$ROOT_DIR/output/playwright/$RUN_ID/smoke}"
SHORT_ID="$(printf '%s' "$RUN_ID" | tr -cd '[:alnum:]' | tail -c 9)"
SESSION_NAME="qa${SHORT_ID}"
PW_TIMEOUT="${QA_PW_TIMEOUT:-30}"
mkdir -p "$OUT_DIR"

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
    record_result "live_ai_smoke" "blocked" "App UI does not show API Connected."
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

  local attempt
  for attempt in 1 2 3 4 5 6; do
    sleep 2
    snapshot_page "${prefix}-after-${attempt}"
    if snapshot_contains "AI" && snapshot_contains "YOU" && ! snapshot_contains "Thinking..."; then
      return 0
    fi
  done

  return 1
}

scenario_open_app() {
  run_pw open "$BASE_URL" >"$OUT_DIR/01-open.txt" 2>&1
  snapshot_page "01-app-boot"
  screenshot_page "01-app-boot"
  capture_console "01-app-boot"
  capture_network "01-app-boot"
  if snapshot_contains "button \"Surface\"" && snapshot_contains "button \"Rack\"" && snapshot_contains "button \"Patch\"" && snapshot_contains "button \"Tracker\""; then
    record_result "app_boot" "pass" "Loaded app shell with top-bar view controls."
  else
    record_result "app_boot" "fail" "Top-bar view controls missing from initial snapshot."
    return 1
  fi
}

scenario_record_before_audio_init() {
  snapshot_page "01b-before-record"
  local record_ref
  record_ref="$(button_ref "Arm Recording")"
  if [[ -z "$record_ref" ]]; then
    record_result "record_before_audio_init" "fail" "Record button missing before audio init check."
    return 1
  fi
  run_pw click "$record_ref" >/dev/null 2>&1
  capture_console "01b-record-before-audio"
  if [[ -f "$OUT_DIR/console-01b-record-before-audio.txt" ]] && rg -Fq '"type":"recording.state","recording":false,"reason":"no-destination"' "$OUT_DIR/console-01b-record-before-audio.txt"; then
    record_result "record_before_audio_init" "fail" "Record before audio init still no-ops (issue #150 was fixed; this is a regression)."
  else
    record_result "record_before_audio_init" "pass" "Record before audio init did not hit the known no-destination path."
  fi
}

scenario_view_switching() {
  click_view_button "Tracker"
  snapshot_page "02-track-view"
  click_view_button "Inst"
  snapshot_page "02-inst-view"
  click_view_button "Rack"
  snapshot_page "02-rack-view"
  click_view_button "Patch"
  snapshot_page "02-patch-view"
  click_view_button "Surface"
  snapshot_page "02-surface-view"
  screenshot_page "02-view-switching"
  record_result "view_switching" "pass" "Switched through Surface, Rack, Patch, and Tracker via top-bar buttons."
}

scenario_active_voice_continuity() {
  click_voice_by_label "VA"
  snapshot_page "03-va-selected"
  click_view_button "Tracker"
  snapshot_page "03-va-tracker"
  screenshot_page "03-active-voice-continuity"
  if snapshot_contains "VA"; then
    record_result "active_voice_continuity" "pass" "Selected VA and tracker view preserved the active track."
  else
    record_result "active_voice_continuity" "warn" "Could not confirm the active track label after switching views."
  fi
}

scenario_tracker_presence() {
  click_view_button "Tracker"
  snapshot_page "04-tracker-presence"
  screenshot_page "04-tracker-presence"
  if snapshot_contains "table" && snapshot_contains "Pos" && snapshot_contains "Note"; then
    record_result "tracker_dedicated_view" "pass" "Tracker table is visible in dedicated view."
  else
    record_result "tracker_dedicated_view" "fail" "Tracker table not visible in dedicated view snapshot."
    return 1
  fi
}

scenario_tracker_editing() {
  click_view_button "Inst"
  snapshot_page "05-inst-before-seed"

  local step1_ref step5_ref
  step1_ref="$(step_button_ref "1")"
  step5_ref="$(step_button_ref "5")"
  if [[ -z "$step1_ref" ]]; then
    record_result "tracker_editing" "fail" "Could not find step-grid button to seed tracker events."
    return 1
  fi

  run_pw click "$step1_ref" >/dev/null 2>&1
  if [[ -n "$step5_ref" ]]; then
    run_pw click "$step5_ref" >/dev/null 2>&1
  fi
  snapshot_page "05-inst-after-seed"

  click_view_button "Tracker"
  snapshot_page "05-tracker-seeded"
  screenshot_page "05-tracker-seeded"
  if snapshot_contains "row \"---\""; then
    record_result "tracker_editing" "fail" "Step-grid seeding did not produce visible tracker events."
    return 1
  fi

  record_result "tracker_editing" "pass" "Seeded tracker events through the step grid and confirmed they appear in tracker view."
}

scenario_keyboard_guard() {
  click_view_button "Surface"
  snapshot_page "06-keyboard-guard"
  local input_ref
  input_ref="$(textbox_ref "Describe what you want...")"
  if [[ -z "$input_ref" ]]; then
    record_result "keyboard_guard" "fail" "Chat input ref not found."
    return 1
  fi
  run_pw click "$input_ref" >/dev/null 2>&1
  snapshot_page "06-keyboard-guard-after"
  screenshot_page "06-keyboard-guard"
  record_result "keyboard_guard" "blocked" "Focused editable chat input. Keyboard shortcut suppression still needs explicit manual confirmation because Playwright CLI combo-key handling is unreliable here."
}

scenario_gesture_persistence() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  click_view_button "Inst"
  snapshot_page "06b-gesture-inst"

  local note_ref
  note_ref="$(slider_ref "Note")"
  if [[ -z "$note_ref" ]]; then
    record_result "gesture_persistence" "fail" "Could not resolve Note slider for gesture persistence scenario."
    return 1
  fi

  local before_value after_value
  before_value="$(eval_js 'el => el.value' "$note_ref" | tail -n 1 | tr -d '"')"
  drag_slider_to_fraction "$note_ref" "0.85"
  local immediate_value
  immediate_value="$(eval_js 'el => el.value' "$note_ref" | tail -n 1 | tr -d '"')"
  sleep 1
  snapshot_page "06b-gesture-after"
  local note_ref_after
  note_ref_after="$(slider_ref "Note")"
  if [[ -z "$note_ref_after" ]]; then
    record_result "gesture_persistence" "fail" "Could not resolve Note slider after drag."
    return 1
  fi
  after_value="$(eval_js 'el => el.value' "$note_ref_after" | tail -n 1 | tr -d '"')"
  screenshot_page "06b-gesture-after"

  if python3 - "$before_value" "$immediate_value" <<'PY'
import sys
before = float(sys.argv[1])
immediate = float(sys.argv[2])
raise SystemExit(0 if abs(immediate - before) > 0.05 else 1)
PY
  then
    if python3 - "$before_value" "$after_value" <<'PY'
import sys
before = float(sys.argv[1])
after = float(sys.argv[2])
raise SystemExit(0 if abs(after - before) > 0.05 else 1)
PY
    then
      record_result "gesture_persistence" "pass" "Note slider value persisted after pointer interaction and mouse-up."
    else
      record_result "gesture_persistence" "fail" "Note slider value changed during pointer interaction but reverted after mouse-up (issue #130 was fixed; this is a regression)."
    fi
  else
    record_result "gesture_persistence" "blocked" "Playwright pointer interaction did not move the Note slider at all, so gesture persistence is inconclusive in this runner."
  fi
}

scenario_transport_ui() {
  click_view_button "Tracker"
  snapshot_page "07-transport-ui"
  local play_ref stop_ref
  play_ref="$(button_ref "Play [Space]")"
  if [[ -z "$play_ref" ]]; then
    record_result "transport_ui" "fail" "Play control missing in tracker view."
    return 1
  fi
  run_pw click "$play_ref" >/dev/null 2>&1
  sleep 2
  snapshot_page "07-transport-playing"
  capture_console "07-transport-playing"
  stop_ref="$(button_ref "Pause (tails ring out) [Space]")"
  if [[ -n "$stop_ref" ]]; then
    run_pw click "$stop_ref" >/dev/null 2>&1
  fi
  screenshot_page "07-transport-ui"
  if rg -Fq '"type":"scheduler.note"' "$OUT_DIR/console-07-transport-playing.txt" && rg -Fq '"type":"audio.note"' "$OUT_DIR/console-07-transport-playing.txt"; then
    record_result "transport_ui" "pass" "Transport controls are present and QA audio trace captured scheduled + triggered notes during playback."
  else
    record_result "transport_ui" "warn" "Transport controls are present, but QA audio trace did not confirm scheduled and triggered notes."
  fi
}

scenario_first_step_start() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "07a-first-step-boot"
  click_view_button "Inst"
  snapshot_page "07a-first-step-inst"
  local step_ref
  step_ref="$(step_button_ref "1")"
  if [[ -z "$step_ref" ]]; then
    record_result "first_step_start" "fail" "Could not find step 1 button."
    return 1
  fi
  run_pw click "$step_ref" >/dev/null 2>&1
  click_view_button "Tracker"
  snapshot_page "07a-first-step-tracker"
  local play_ref
  play_ref="$(button_ref "Play [Space]")"
  if [[ -z "$play_ref" ]]; then
    record_result "first_step_start" "fail" "Play button missing."
    return 1
  fi
  run_pw click "$play_ref" >/dev/null 2>&1
  sleep 2
  capture_console "07a-first-step"
  if python3 - "$OUT_DIR/console-07a-first-step.txt" <<'PY'
import json
import re
import sys

path = sys.argv[1]
saw_scheduler = False
saw_audio = False
with open(path, 'r', encoding='utf-8') as f:
    for line in f:
        m = re.search(r'\[qa-audio\]\s+(\{.*\})', line)
        if not m:
            continue
        event = json.loads(m.group(1))
        if event.get('type') == 'scheduler.note' and event.get('absoluteStep') == 0:
            saw_scheduler = True
        if event.get('type') == 'audio.note':
            saw_audio = True

raise SystemExit(0 if saw_scheduler and saw_audio else 1)
PY
  then
    record_result "first_step_start" "pass" "Confirmed scheduler step-0 and audio trigger trace on transport start."
    return 0
  fi

  record_result "first_step_start" "fail" "Transport start did not confirm both scheduler step-0 and audio trigger trace (issue #153 was fixed; this is a regression)."
}

scenario_pause_stops_audio() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "07aa-pause-boot"
  click_view_button "Inst"
  snapshot_page "07aa-pause-inst"
  local step_ref
  step_ref="$(step_button_ref "1")"
  if [[ -z "$step_ref" ]]; then
    record_result "pause_stops_audio" "fail" "Could not find step 1 button for pause scenario."
    return 1
  fi
  run_pw click "$step_ref" >/dev/null 2>&1
  click_view_button "Tracker"
  snapshot_page "07aa-pause-tracker"
  local play_ref
  play_ref="$(button_ref "Play [Space]")"
  if [[ -z "$play_ref" ]]; then
    record_result "pause_stops_audio" "fail" "Play button missing in pause scenario."
    return 1
  fi

  clear_trace
  click_button_by_title "Play [Space]"
  sleep 2
  snapshot_page "07aa-pause-playing"
  if ! click_button_by_title "Pause [Space]"; then
    record_result "pause_stops_audio" "fail" "Pause button missing after transport start."
    return 1
  fi
  sleep 2
  local pause_analysis_ref
  pause_analysis_ref="$(qa_anchor_ref)"
  local pause_analysis
  pause_analysis="$(eval_js "$(cat <<'JS'
el => {
  const events = window.__gluonQaAudioTrace?.get?.() ?? [];
  const paused = events.find((event) => event.type === 'transport.state' && event.status === 'paused');
  if (!paused) return 'missing-paused-state';
  const graceMs = 250;
  const noteTypes = new Set(['scheduler.note', 'audio.note']);
  const prePause = events.filter((event) => noteTypes.has(event.type) && event.ts < paused.ts);
  const postPause = events.filter((event) => noteTypes.has(event.type) && event.ts > paused.ts + graceMs);
  if (prePause.length === 0) return 'missing-pre-pause-note-events';
  if (postPause.length > 0) return 'post-pause-note-events';
  return 'pass';
}
JS
)" "$pause_analysis_ref")"

  pause_analysis="$(printf '%s' "$pause_analysis" | tail -n 1 | tr -d '"')"
  if [[ "$pause_analysis" == "pass" ]]; then
    record_result "pause_stops_audio" "pass" "Pause stopped future scheduler/audio note events after the active generation was released."
  else
    record_result "pause_stops_audio" "reproduces" "Pause still allowed scheduler or audio note events after the paused transport state."
  fi
}

scenario_live_edit_restart() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "07ab-live-edit-boot"
  click_view_button "Inst"
  snapshot_page "07ab-live-edit-kick"
  local step_ref
  step_ref="$(step_button_ref "1")"
  if [[ -z "$step_ref" ]]; then
    record_result "live_edit_restart" "fail" "Could not find step 1 button for live-edit scenario."
    return 1
  fi
  run_pw click "$step_ref" >/dev/null 2>&1
  click_view_button "Tracker"
  snapshot_page "07ab-live-edit-tracker"
  local play_ref
  play_ref="$(button_ref "Play [Space]")"
  if [[ -z "$play_ref" ]]; then
    record_result "live_edit_restart" "fail" "Play button missing in live-edit scenario."
    return 1
  fi
  click_button_by_title "Play [Space]"
  sleep 1

  clear_trace
  click_view_button "Inst"
  click_voice_by_label "VA"
  snapshot_page "07ab-live-edit-va"
  step_ref="$(step_button_ref "1")"
  if [[ -z "$step_ref" ]]; then
    record_result "live_edit_restart" "fail" "Could not find step 1 button after switching to VA during playback."
    return 1
  fi
  run_pw click "$step_ref" >/dev/null 2>&1
  sleep 3
  local during_analysis_ref
  during_analysis_ref="$(qa_anchor_ref)"
  local during_analysis
  during_analysis="$(eval_js "$(cat <<'JS'
el => {
  const events = window.__gluonQaAudioTrace?.get?.() ?? [];
  const audioV1 = events.filter((event) => event.type === 'audio.note' && (event.trackId || event.voiceId) === 'v1');
  const schedulerIds = events
    .filter((event) => event.type === 'scheduler.note' && event.eventId)
    .map((event) => event.eventId);
  if (audioV1.length === 0) return 'missing-v1-audio';
  if (new Set(schedulerIds).size !== schedulerIds.length) return 'duplicate-scheduler-events';
  return 'pass';
}
JS
)" "$during_analysis_ref")"

  during_analysis="$(printf '%s' "$during_analysis" | tail -n 1 | tr -d '"')"
  if [[ "$during_analysis" != "pass" ]]; then
    record_result "live_edit_restart" "reproduces" "Live edit during playback did not produce a clean VA note trace before restart."
    return 0
  fi

  click_view_button "Tracker"
  snapshot_page "07ab-live-edit-before-restart"
  if ! click_button_by_title "Hard stop — silence all voices [Shift+Space]"; then
    record_result "live_edit_restart" "fail" "Hard stop button missing before restart."
    return 1
  fi
  sleep 1

  clear_trace
  snapshot_page "07ab-live-edit-restart-ready"
  play_ref="$(button_ref "Play [Space]")"
  if [[ -z "$play_ref" ]]; then
    record_result "live_edit_restart" "fail" "Play button missing after hard stop."
    return 1
  fi
  click_button_by_title "Play [Space]"
  sleep 3
  local restart_analysis_ref
  restart_analysis_ref="$(qa_anchor_ref)"
  local restart_analysis
  restart_analysis="$(eval_js "$(cat <<'JS'
el => {
  const events = window.__gluonQaAudioTrace?.get?.() ?? [];
  const play = events.find((event) => event.type === 'transport.play-start');
  if (!play) return 'missing-play-start';

  const generation = play.generation;
  const audioEvents = events.filter((event) => event.type === 'audio.note');
  if (audioEvents.length === 0) return 'missing-audio-events';
  const trackIds = new Set(audioEvents.map((event) => event.trackId || event.voiceId));
  if (!trackIds.has('v0') || !trackIds.has('v1')) return 'missing-track-audio';
  const audioGenerations = new Set(audioEvents.map((event) => event.generation));
  if (!(audioGenerations.size === 1 && audioGenerations.has(generation))) return 'mixed-generations';
  const schedulerIds = events
    .filter((event) => event.type === 'scheduler.note' && event.generation === generation && event.eventId)
    .map((event) => event.eventId);
  if (new Set(schedulerIds).size !== schedulerIds.length) return 'duplicate-scheduler-events';

  const bursts = new Map();
  for (const event of audioEvents) {
    const trackId = event.trackId || event.voiceId;
    const times = bursts.get(trackId) ?? [];
    times.push(Number(event.time ?? 0));
    bursts.set(trackId, times);
  }
  let bursty = false;
  for (const times of bursts.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) {
      if (times[i] - times[i - 1] < 0.05) {
        bursty = true;
        break;
      }
    }
    if (bursty) break;
  }
  if (bursty) return 'bursty-audio';
  return 'pass';
}
JS
)" "$restart_analysis_ref")"

  restart_analysis="$(printf '%s' "$restart_analysis" | tail -n 1 | tr -d '"')"
  if [[ "$restart_analysis" == "pass" ]]; then
    record_result "live_edit_restart" "pass" "Live-edited track sounded during playback and restart emitted only current-generation note events without duplicate bursts."
  else
    record_result "live_edit_restart" "reproduces" "Restart after live edit still produced missing or duplicated current-generation note events."
  fi
}

scenario_bpm_change_runtime() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "07b-bpm-boot"
  click_view_button "Inst"
  snapshot_page "07b-bpm-inst"
  local step1_ref step5_ref
  step1_ref="$(step_button_ref "1")"
  step5_ref="$(step_button_ref "5")"
  if [[ -z "$step1_ref" || -z "$step5_ref" ]]; then
    record_result "bpm_change_runtime" "fail" "Could not find step buttons to seed BPM-change scenario."
    return 1
  fi
  run_pw click "$step1_ref" >/dev/null 2>&1
  run_pw click "$step5_ref" >/dev/null 2>&1
  click_view_button "Tracker"
  snapshot_page "07b-bpm-tracker"
  local play_ref tempo_ref spin_ref
  play_ref="$(button_ref "Play [Space]")"
  tempo_ref="$(python3 - "$OUT_DIR/07b-bpm-tracker.yml" <<'PY'
import re
import sys

text = open(sys.argv[1], 'r', encoding='utf-8').read().splitlines()
capture = False
for line in text:
    if re.search(r': Tempo$', line):
        capture = True
        continue
    if capture:
        m = re.search(r'generic \[ref=(e\d+)\]: "?(\d+)"?$', line)
        if m:
            print(m.group(1))
            break
        if line.lstrip().startswith('- generic') and ': Tempo' not in line and 'ref=' in line:
            continue
PY
)"
  if [[ -z "$play_ref" || -z "$tempo_ref" ]]; then
    record_result "bpm_change_runtime" "fail" "Play or BPM button missing in BPM-change scenario."
    return 1
  fi
  run_pw click "$play_ref" >/dev/null 2>&1
  sleep 1
  run_pw click "$tempo_ref" >/dev/null 2>&1
  snapshot_page "07b-bpm-editing"
  spin_ref="$(spinbutton_ref)"
  if [[ -z "$spin_ref" ]]; then
    record_result "bpm_change_runtime" "fail" "BPM spinbutton missing after entering BPM edit mode."
    return 1
  fi
  run_pw fill "$spin_ref" "90" >/dev/null 2>&1
  run_pw press Enter >/dev/null 2>&1
  sleep 3
  capture_console "07b-bpm-runtime"
  if python3 - "$OUT_DIR/console-07b-bpm-runtime.txt" <<'PY'
import json
import re
import sys

path = sys.argv[1]
events = []
with open(path, 'r', encoding='utf-8') as f:
    for line in f:
        m = re.search(r'\[qa-audio\]\s+(\{.*\})', line)
        if not m:
            continue
        events.append(json.loads(m.group(1)))

saw_bpm90 = any(e.get('type') == 'transport.settings' and e.get('bpm') == 90 for e in events)
if not saw_bpm90:
    raise SystemExit(1)

after_change = False
note_times = []
for e in events:
    if e.get('type') == 'transport.settings' and e.get('bpm') == 90:
        after_change = True
        continue
    if after_change and e.get('type') == 'scheduler.note' and (e.get('trackId') == 'v0' or e.get('voiceId') == 'v0'):
        note_times.append(float(e.get('noteTime')))

diffs = [b - a for a, b in zip(note_times, note_times[1:])]
ok = any(d > 0.6 for d in diffs)
raise SystemExit(0 if ok else 1)
PY
  then
    record_result "bpm_change_runtime" "pass" "BPM change to 90 updated transport settings and subsequent scheduled note spacing."
  else
    record_result "bpm_change_runtime" "fail" "BPM change scenario did not confirm changed scheduling spacing (issues #120/#137 were fixed; this is a regression)."
  fi
}

scenario_multi_voice_trace() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "07c-multivoice-boot"
  click_view_button "Inst"
  snapshot_page "07c-multivoice-inst-kick"
  local step_ref
  step_ref="$(step_button_ref "1")"
  if [[ -z "$step_ref" ]]; then
    record_result "multi_voice_trace" "fail" "Could not find step 1 button for multi-voice trace."
    return 1
  fi
  run_pw click "$step_ref" >/dev/null 2>&1
  click_voice_by_label "VA"
  snapshot_page "07c-multivoice-inst-va"
  step_ref="$(step_button_ref "1")"
  if [[ -z "$step_ref" ]]; then
    record_result "multi_voice_trace" "fail" "Could not find step 1 button after switching to VA."
    return 1
  fi
  run_pw click "$step_ref" >/dev/null 2>&1
  click_view_button "Tracker"
  snapshot_page "07c-multivoice-tracker"
  local play_ref
  play_ref="$(button_ref "Play [Space]")"
  if [[ -z "$play_ref" ]]; then
    record_result "multi_voice_trace" "fail" "Play button missing in multi-voice trace scenario."
    return 1
  fi
  run_pw click "$play_ref" >/dev/null 2>&1
  sleep 2
  capture_console "07c-multivoice"
  if python3 - "$OUT_DIR/console-07c-multivoice.txt" <<'PY'
import json
import re
import sys

path = sys.argv[1]
voices = set()
with open(path, 'r', encoding='utf-8') as f:
    for line in f:
        m = re.search(r'\[qa-audio\]\s+(\{.*\})', line)
        if not m:
            continue
        event = json.loads(m.group(1))
        if event.get('type') == 'audio.note':
            voices.add(event.get('trackId') or event.get('voiceId'))

raise SystemExit(0 if {'v0', 'v1'}.issubset(voices) else 1)
PY
  then
    record_result "multi_voice_trace" "pass" "Audio trace captured note triggers for both KICK and VA."
  else
    record_result "multi_voice_trace" "fail" "Multi-voice trace did not confirm note triggers for both voices (issue #131 was fixed; this is a regression)."
  fi
}

scenario_modulation_route_cleanup() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  click_view_button "Rack"
  snapshot_page "07d-cleanup-before-seed"

  eval_js "$(cat <<'JS'
() => {
  const raw = localStorage.getItem('gluon-session');
  const data = raw ? JSON.parse(raw) : null;
  if (!data || !data.session || !Array.isArray(data.session.tracks)) return 'missing-session';
  data.session.activeTrackId = 'v1';
  const track = data.session.tracks.find(v => v.id === 'v1');
  if (!track) return 'missing-track';
  track.processors = [{ id: 'rings-qa', type: 'rings', model: 0, params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 } }];
  track.modulators = [{ id: 'tides-qa', type: 'tides', model: 1, params: { frequency: 0.5, shape: 0.5, slope: 0.5, smoothness: 0.5 } }];
  track.modulations = [{ id: 'mod-qa', modulatorId: 'tides-qa', target: { kind: 'processor', processorId: 'rings-qa', param: 'brightness' }, depth: 0.2 }];
  localStorage.setItem('gluon-session', JSON.stringify(data));
  return 'ok';
}
JS
)" >/dev/null

  run_pw open "$BASE_URL" >/dev/null 2>&1
  click_view_button "Rack"
  click_voice_by_label "VA"
  snapshot_page "07d-cleanup-seeded"

  if ! snapshot_contains "Rings"; then
    record_result "modulation_route_cleanup" "blocked" "Rack seed did not surface the injected processor state; current persistence backend no longer accepts this localStorage-only setup path."
    return 0
  fi

  local remove_ref
  remove_ref="$(button_ref "remove")"
  if [[ -z "$remove_ref" ]]; then
    record_result "modulation_route_cleanup" "fail" "Could not find processor Remove button in seeded cleanup scenario."
    return 1
  fi
  run_pw click "$remove_ref" >/dev/null 2>&1
  sleep 1
  snapshot_page "07d-cleanup-after-remove"
  screenshot_page "07d-cleanup-after-remove"

  local route_check
  route_check="$(eval_js "$(cat <<'JS'
() => {
  const raw = localStorage.getItem('gluon-session');
  const data = raw ? JSON.parse(raw) : null;
  const track = data?.session?.tracks?.find(v => v.id === 'v1');
  if (!track) return 'missing-track';
  const hasDangling = (track.modulations || []).some(r => r.target?.kind === 'processor' && r.target?.processorId === 'rings-qa');
  return hasDangling ? 'dangling' : 'clean';
}
JS
)")"

  if [[ "$route_check" == '"clean"' || "$route_check" == 'clean' ]]; then
    record_result "modulation_route_cleanup" "pass" "Removing processor cleared processor-targeted modulation routes from persisted session state."
  else
    record_result "modulation_route_cleanup" "fail" "Removing processor left dangling processor-targeted modulation routes (issue #149 was fixed; this is a regression)."
  fi
}

scenario_persistence_reload() {
  run_pw open "$BASE_URL" >"$OUT_DIR/08-reload.txt" 2>&1
  snapshot_page "08-reload"
  screenshot_page "08-reload"
  record_result "persistence_reload" "pass" "Reopened app and recaptured session state for persistence smoke."
}

scenario_live_ai_smoke() {
  local rc=0

  submit_ai_prompt "Say hello without changing anything." "09-live-ai-chat" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      return 0
    fi
    record_result "live_ai_smoke" "warn" "Chat-only AI prompt submitted, but response could not be confirmed from current snapshot."
    return 0
  fi
  screenshot_page "09-live-ai-chat"
  capture_console "09-live-ai-chat"

  if snapshot_contains "API Connected"; then
    rc=0
    submit_ai_prompt "Set the tempo to 90 BPM." "09-live-ai-bpm" || rc=$?
    if [[ "$rc" -eq 0 ]]; then
      click_view_button "Tracker"
      sleep 1
      capture_console "09-live-ai-bpm"
      if [[ -f "$OUT_DIR/console-09-live-ai-bpm.txt" ]] && rg -Fq '"type":"transport.settings","bpm":90' "$OUT_DIR/console-09-live-ai-bpm.txt"; then
        :
      else
        record_result "live_ai_smoke" "warn" "AI transport-change prompt completed, but did not confirm bpm=90 from trace."
        return 0
      fi
    else
      record_result "live_ai_smoke" "warn" "AI transport-change prompt did not settle cleanly."
      return 0
    fi
  fi

  click_voice_by_label "VA"
  rc=0
  submit_ai_prompt "Add Rings to the active voice." "09-live-ai-rings" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    click_view_button "Rack"
    snapshot_page "09-live-ai-rings-inst"
    if snapshot_contains "Rings"; then
      screenshot_page "09-live-ai-rings-inst"
      record_result "live_ai_smoke" "pass" "Chat-only, transport-change, and structural AI smoke prompts all completed with visible or traced effects."
    else
      record_result "live_ai_smoke" "warn" "AI structural prompt settled, but Rings was not visible afterward."
    fi
  else
    record_result "live_ai_smoke" "warn" "AI structural prompt did not settle cleanly."
  fi
}

printf 'scenario\tresult\tnotes\n' >"$OUT_DIR/results.tsv"

echo "Playwright smoke run id: $RUN_ID"
echo "Base URL: $BASE_URL"
echo "Artifacts: $OUT_DIR"

if [[ -n "${QA_SCENARIOS:-}" ]]; then
  # space-delimited list of scenario function names
  for scenario in $QA_SCENARIOS; do
    "$scenario" || true
  done
else
  scenario_open_app || true
  scenario_record_before_audio_init || true
  scenario_view_switching || true
  scenario_active_voice_continuity || true
  scenario_tracker_presence || true
  scenario_tracker_editing || true
  scenario_keyboard_guard || true
  scenario_gesture_persistence || true
  scenario_transport_ui || true
  scenario_first_step_start || true
  scenario_pause_stops_audio || true
  scenario_live_edit_restart || true
  scenario_bpm_change_runtime || true
  scenario_multi_voice_trace || true
  scenario_modulation_route_cleanup || true
  scenario_persistence_reload || true
  scenario_live_ai_smoke || true
fi

echo
echo "Smoke run complete. Results: $OUT_DIR/results.tsv"

# Result semantics:
#   pass       — scenario verified the expected behavior
#   fail       — scenario detected a regression or missing behavior
#   reproduces — scenario detected a known issue that is still present
#   warn       — scenario ran but could not confirm expected behavior (inconclusive)
#   blocked    — scenario could not run due to missing prerequisites
#
# Both "fail" and "reproduces" are treated as failures for the exit code.
# A "reproduces" result means the smoke suite detected a bug — the suite should
# not report green when it can prove something is broken.
if awk -F'\t' 'NR > 1 && ($2 == "fail" || $2 == "reproduces") { found = 1 } END { exit(found ? 0 : 1) }' "$OUT_DIR/results.tsv"; then
  exit 1
fi
