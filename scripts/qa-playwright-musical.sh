#!/usr/bin/env bash
set -euo pipefail

# Musical competence validation — verifies the AI produces correct musical output.
#
# Sends musical prompts, extracts NoteEvents/TriggerEvents from session state,
# and verifies musical correctness (pitch sets, rhythm patterns, motion, spacing).
#
# Depends on the same Playwright CLI wrapper as qa-playwright-smoke.sh.

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
OUT_DIR="${QA_OUT_DIR:-$ROOT_DIR/output/playwright/$RUN_ID/musical}"
SHORT_ID="$(printf '%s' "$RUN_ID" | tr -cd '[:alnum:]' | tail -c 9)"
SESSION_NAME="qam${SHORT_ID}"
PW_TIMEOUT="${QA_PW_TIMEOUT:-45}"
AI_SETTLE_ATTEMPTS="${QA_AI_SETTLE_ATTEMPTS:-8}"
mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------------------
# Helpers — copied from qa-playwright-smoke.sh to keep scripts self-contained
# ---------------------------------------------------------------------------

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

textbox_ref() {
  local label="$1"
  local file
  file="$(current_snapshot_copy)"
  rg -o "textbox \"$label\" \\[ref=(e[0-9]+)\\]" "$file" -r '$1' | head -n 1
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
    record_result "musical_prereq" "blocked" "App UI does not show API Connected."
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
  for attempt in $(seq 1 "$AI_SETTLE_ATTEMPTS"); do
    sleep 3
    snapshot_page "${prefix}-after-${attempt}"
    if snapshot_contains "AI" && snapshot_contains "YOU" && ! snapshot_contains "Thinking..."; then
      return 0
    fi
  done

  return 1
}

# ---------------------------------------------------------------------------
# Event extraction helper — returns JSON array of events from a track's first
# region, filtering out velocity=0 (disabled) events.
# Usage: extract_events <trackId>
# Returns raw JSON on stdout; caller parses with python3.
# ---------------------------------------------------------------------------

extract_events() {
  local track_id="$1"
  local ref
  ref="$(qa_anchor_ref)"
  eval_js "$(cat <<JS
el => {
  const raw = localStorage.getItem('gluon-session');
  const data = raw ? JSON.parse(raw) : null;
  if (!data || !data.session) return JSON.stringify({ error: 'no-session' });
  const track = data.session.tracks.find(t => t.id === '${track_id}');
  if (!track) return JSON.stringify({ error: 'no-track' });
  const region = (track.regions || [])[0];
  if (!region) return JSON.stringify({ error: 'no-region' });
  const events = (region.events || []).filter(e => {
    if (e.velocity !== undefined && e.velocity === 0) return false;
    return true;
  });
  return JSON.stringify(events);
}
JS
)" "$ref"
}

# ---------------------------------------------------------------------------
# Seed events into a track's region via localStorage injection + reload.
# Usage: seed_events <trackId> <json_events_array>
# ---------------------------------------------------------------------------

seed_events() {
  local track_id="$1"
  local events_json="$2"
  local ref
  ref="$(qa_anchor_ref)"
  eval_js "$(cat <<JS
el => {
  const raw = localStorage.getItem('gluon-session');
  const data = raw ? JSON.parse(raw) : null;
  if (!data || !data.session) return 'no-session';
  const track = data.session.tracks.find(t => t.id === '${track_id}');
  if (!track) return 'no-track';
  if (!track.regions || !track.regions[0]) return 'no-region';
  track.regions[0].events = ${events_json};
  localStorage.setItem('gluon-session', JSON.stringify(data));
  return 'ok';
}
JS
)" "$ref" >/dev/null
  run_pw open "$BASE_URL" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Ensure a track uses a melodic engine (virtual-analog) instead of drums.
# Usage: set_melodic_engine <trackId>
# ---------------------------------------------------------------------------

set_melodic_engine() {
  local track_id="$1"
  local ref
  ref="$(qa_anchor_ref)"
  eval_js "$(cat <<JS
el => {
  const raw = localStorage.getItem('gluon-session');
  const data = raw ? JSON.parse(raw) : null;
  if (!data || !data.session) return 'no-session';
  const track = data.session.tracks.find(t => t.id === '${track_id}');
  if (!track) return 'no-track';
  track.engine = 'plaits:virtual_analog';
  track.model = 0;
  localStorage.setItem('gluon-session', JSON.stringify(data));
  return 'ok';
}
JS
)" "$ref" >/dev/null
}

# ---------------------------------------------------------------------------
# Diagnostic printer — outputs events for a scenario in the required format.
# Usage: dump_events <scenario_name> <trackId> <events_json>
# ---------------------------------------------------------------------------

dump_events() {
  local scenario="$1"
  local track_id="$2"
  local events_json="$3"
  python3 - "$scenario" "$track_id" "$events_json" <<'PY'
import json
import sys

scenario = sys.argv[1]
track_id = sys.argv[2]
raw = sys.argv[3]

try:
    events = json.loads(raw)
except Exception:
    print(f"[{scenario}] Track {track_id} events: PARSE ERROR — raw: {raw[:200]}")
    raise SystemExit(0)

if isinstance(events, dict) and 'error' in events:
    print(f"[{scenario}] Track {track_id} events: ERROR — {events['error']}")
    raise SystemExit(0)

print(f"[{scenario}] Track {track_id} events ({len(events)} total):")
for e in events:
    kind = e.get('kind', '?')
    pos = e.get('at', '?')
    vel = e.get('velocity', '?')
    if kind == 'note':
        pitch = e.get('pitch', '?')
        dur = e.get('duration', '?')
        print(f"  pos={pos} kind=note pitch={pitch} vel={vel} dur={dur}")
    elif kind == 'trigger':
        accent = e.get('accent', False)
        print(f"  pos={pos} kind=trigger vel={vel} accent={accent}")
    elif kind == 'parameter':
        cid = e.get('controlId', '?')
        val = e.get('value', '?')
        print(f"  pos={pos} kind=parameter controlId={cid} value={val}")
    else:
        print(f"  pos={pos} kind={kind} raw={json.dumps(e)}")
PY
}

# ---------------------------------------------------------------------------
# Check if AI raised a decision instead of acting (valid M6 behavior).
# Returns 0 if a raise_decision occurred, 1 otherwise.
# ---------------------------------------------------------------------------

check_raised_decision() {
  local file
  file="$(current_snapshot_copy)"
  if [[ -z "$file" ]]; then return 1; fi
  if rg -Fq "decision" "$file" 2>/dev/null; then
    return 0
  fi
  return 1
}

# ===========================================================================
# SCENARIOS
# ===========================================================================

# ---------------------------------------------------------------------------
# Boot — open the app and verify API is connected
# ---------------------------------------------------------------------------

scenario_boot() {
  run_pw open "$BASE_URL" >"$OUT_DIR/00-open.txt" 2>&1
  snapshot_page "00-boot"
  screenshot_page "00-boot"

  if ! snapshot_contains "API Connected"; then
    record_result "musical_boot" "blocked" "App does not show API Connected — all musical scenarios will be skipped."
    return 1
  fi
  record_result "musical_boot" "pass" "App booted with API Connected."
}

# ===========================================================================
# PITCH & HARMONY
# ===========================================================================

# ---------------------------------------------------------------------------
# H1: Arpeggio — "Arpeggiate a C major chord"
# Expect: pitches in {0,4,7} mod 12, ascending or descending, >=3 distinct
# ---------------------------------------------------------------------------

scenario_H1_arpeggio() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "H1-boot"

  local rc=0
  submit_ai_prompt "Arpeggiate a C major chord on the active track. Use note events with MIDI pitches." "H1" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "H1_arpeggio" "blocked" "No API connection."
      return 0
    fi
    record_result "H1_arpeggio" "warn" "AI prompt did not settle."
    return 0
  fi

  # Find which track got events — try active track first, then scan all
  local events_json track_id
  for tid in v0 v1 v2 v3; do
    events_json="$(extract_events "$tid")"
    if python3 -c "import json,sys; e=json.loads(sys.argv[1]); sys.exit(0 if isinstance(e,list) and len(e)>=3 else 1)" "$events_json" 2>/dev/null; then
      track_id="$tid"
      break
    fi
  done

  if [[ -z "${track_id:-}" ]]; then
    if check_raised_decision; then
      record_result "H1_arpeggio" "warn" "AI raised a decision instead of acting. [FN-RISK]"
      return 0
    fi
    dump_events "H1_arpeggio" "v0" "$(extract_events v0)"
    record_result "H1_arpeggio" "fail" "No track had >=3 events after arpeggio prompt."
    return 0
  fi

  dump_events "H1_arpeggio" "$track_id" "$events_json"

  python3 - "$events_json" <<'PY'
import json
import sys

events = json.loads(sys.argv[1])
# Accept both note and trigger events (FN-RISK: pitched instruments may get triggers)
pitches = []
for e in events:
    if e.get('kind') == 'note' and 'pitch' in e:
        pitches.append(int(e['pitch']))
    elif e.get('kind') == 'trigger':
        pass  # cannot check pitch on triggers

c_major_mod12 = {0, 4, 7}
pitch_classes = {p % 12 for p in pitches}
all_in_cmaj = pitch_classes.issubset(c_major_mod12)
distinct = len(pitch_classes)

result = "YES" if all_in_cmaj else "NO"
print(f"[H1_arpeggio] Assertion: c_major_pitches — pitch classes {pitch_classes} all in C major {{0,4,7}}? {result}")

result2 = "YES" if distinct >= 3 else "NO"
print(f"[H1_arpeggio] Assertion: distinct_pitches — {distinct} distinct pitch classes >= 3? {result2}")

# Check ascending or descending order
ascending = all(pitches[i] <= pitches[i+1] for i in range(len(pitches)-1))
descending = all(pitches[i] >= pitches[i+1] for i in range(len(pitches)-1))
ordered = ascending or descending
result3 = "YES" if ordered else "NO (mixed — still valid musically)"
print(f"[H1_arpeggio] Assertion: ordered — ascending or descending? {result3}")

if len(pitches) == 0:
    print("[H1_arpeggio] [FN-RISK] No NoteEvents with pitch found — may be TriggerEvents on a pitched engine.")

sys.exit(0 if (all_in_cmaj and distinct >= 3) else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "H1_arpeggio" "pass" "C major arpeggio: correct pitch classes, >=3 distinct."
  else
    record_result "H1_arpeggio" "fail" "C major arpeggio pitch validation failed. [FN-RISK: trigger events may lack pitch]"
  fi
}

# ---------------------------------------------------------------------------
# H2: Scale-correct melody — "Write a melody in D minor"
# Expect: pitches in D natural minor, >=4 distinct pitch classes, range >=7 semitones
# ---------------------------------------------------------------------------

scenario_H2_scale_melody() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "H2-boot"

  local rc=0
  submit_ai_prompt "Write a melody in D minor on the active track. Use note events with MIDI pitches. At least 6 notes." "H2" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "H2_scale_melody" "blocked" "No API connection."
      return 0
    fi
    record_result "H2_scale_melody" "warn" "AI prompt did not settle."
    return 0
  fi

  local events_json track_id
  for tid in v0 v1 v2 v3; do
    events_json="$(extract_events "$tid")"
    if python3 -c "import json,sys; e=json.loads(sys.argv[1]); sys.exit(0 if isinstance(e,list) and len(e)>=4 else 1)" "$events_json" 2>/dev/null; then
      track_id="$tid"
      break
    fi
  done

  if [[ -z "${track_id:-}" ]]; then
    if check_raised_decision; then
      record_result "H2_scale_melody" "warn" "AI raised a decision instead of acting. [FN-RISK]"
      return 0
    fi
    dump_events "H2_scale_melody" "v0" "$(extract_events v0)"
    record_result "H2_scale_melody" "fail" "No track had >=4 events after D minor melody prompt."
    return 0
  fi

  dump_events "H2_scale_melody" "$track_id" "$events_json"

  python3 - "$events_json" <<'PY'
import json
import sys

events = json.loads(sys.argv[1])
pitches = [int(e['pitch']) for e in events if e.get('kind') == 'note' and 'pitch' in e]

# D natural minor: D E F G A Bb C = {2, 4, 5, 7, 9, 10, 0}
d_minor_mod12 = {2, 4, 5, 7, 9, 10, 0}
# Also accept D harmonic minor (add C#=1) and D melodic minor ascending (add B=11, C#=1)
d_minor_extended = d_minor_mod12 | {1, 11}

pitch_classes = {p % 12 for p in pitches}
all_in_dmin = pitch_classes.issubset(d_minor_extended)
distinct = len(pitch_classes)
pitch_range = (max(pitches) - min(pitches)) if pitches else 0

result = "YES" if all_in_dmin else "NO"
outliers = pitch_classes - d_minor_extended
print(f"[H2_scale_melody] Assertion: scale_correct — pitches {pitch_classes} all in D minor (natural/harmonic/melodic)? {result}" + (f" outliers={outliers}" if outliers else ""))

result2 = "YES" if distinct >= 4 else "NO"
print(f"[H2_scale_melody] Assertion: distinct_pitches — {distinct} distinct pitch classes >= 4? {result2}")

result3 = "YES" if pitch_range >= 7 else "NO"
print(f"[H2_scale_melody] Assertion: range — {pitch_range} semitones >= 7? {result3}")

if len(pitches) == 0:
    print("[H2_scale_melody] [FN-RISK] No NoteEvents with pitch found.")

sys.exit(0 if (all_in_dmin and distinct >= 4 and pitch_range >= 7) else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "H2_scale_melody" "pass" "D minor melody: scale-correct, >=4 distinct, range >=7."
  else
    record_result "H2_scale_melody" "fail" "D minor melody validation failed."
  fi
}

# ---------------------------------------------------------------------------
# H3: Chord progression bass — "Write bass line i-iv-v-i in C minor"
# Expect: root pitches per beat group match C(0), F(5), G(7), C(0) mod 12
# ---------------------------------------------------------------------------

scenario_H3_chord_progression() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "H3-boot"

  local rc=0
  submit_ai_prompt "Write a bass line following the chord progression i-iv-v-i in C minor on the active track. Use note events with MIDI pitches. One chord per 4 steps." "H3" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "H3_chord_progression" "blocked" "No API connection."
      return 0
    fi
    record_result "H3_chord_progression" "warn" "AI prompt did not settle."
    return 0
  fi

  local events_json track_id
  for tid in v0 v1 v2 v3; do
    events_json="$(extract_events "$tid")"
    if python3 -c "import json,sys; e=json.loads(sys.argv[1]); sys.exit(0 if isinstance(e,list) and len(e)>=4 else 1)" "$events_json" 2>/dev/null; then
      track_id="$tid"
      break
    fi
  done

  if [[ -z "${track_id:-}" ]]; then
    if check_raised_decision; then
      record_result "H3_chord_progression" "warn" "AI raised a decision instead of acting. [FN-RISK]"
      return 0
    fi
    dump_events "H3_chord_progression" "v0" "$(extract_events v0)"
    record_result "H3_chord_progression" "fail" "No track had >=4 events after bass line prompt."
    return 0
  fi

  dump_events "H3_chord_progression" "$track_id" "$events_json"

  python3 - "$events_json" <<'PY'
import json
import sys

events = json.loads(sys.argv[1])
notes = [(e['at'], int(e['pitch'])) for e in events if e.get('kind') == 'note' and 'pitch' in e]
notes.sort()

if len(notes) < 4:
    print(f"[H3_chord_progression] Only {len(notes)} notes — need at least 4.")
    sys.exit(1)

# Expected root pitch classes per beat group (4 steps each): C=0, F=5, G=7, C=0
expected_roots = [0, 5, 7, 0]

# Group notes into 4-step beat groups
groups = {}
for at, pitch in notes:
    group_idx = int(at) // 4
    groups.setdefault(group_idx, []).append(pitch)

# Check first note of each group against expected root
matched = 0
total_groups = min(4, len(groups))
for i in range(total_groups):
    if i not in groups:
        continue
    first_pitch = groups[i][0]
    pc = first_pitch % 12
    expected = expected_roots[i] if i < len(expected_roots) else None
    match = pc == expected if expected is not None else False
    label = "YES" if match else "NO"
    print(f"[H3_chord_progression] Assertion: group_{i}_root — pitch class {pc} == {expected}? {label}")
    if match:
        matched += 1

result = "YES" if matched >= 3 else "NO"
print(f"[H3_chord_progression] Assertion: root_progression — {matched}/{total_groups} groups matched expected roots >= 3? {result}")

if len(notes) == 0:
    print("[H3_chord_progression] [FN-RISK] No NoteEvents with pitch found.")

sys.exit(0 if matched >= 3 else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "H3_chord_progression" "pass" "i-iv-v-i bass progression: root pitches match."
  else
    record_result "H3_chord_progression" "fail" "i-iv-v-i bass progression root pitch validation failed."
  fi
}

# ---------------------------------------------------------------------------
# H4: Counterpoint — Seed ascending melody, prompt contrary motion
# Expect: >=60% contrary motion pairs between the two tracks
# ---------------------------------------------------------------------------

scenario_H4_counterpoint() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "H4-boot"

  # Seed an ascending C major scale on v1 (melodic engine)
  set_melodic_engine "v1"
  local seed_events='[
    {"kind":"note","at":0,"pitch":60,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":2,"pitch":62,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":4,"pitch":64,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":6,"pitch":65,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":8,"pitch":67,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":10,"pitch":69,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":12,"pitch":71,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":14,"pitch":72,"velocity":0.8,"duration":0.25}
  ]'
  seed_events "v1" "$seed_events"
  snapshot_page "H4-seeded"

  local rc=0
  submit_ai_prompt "Track v1 has an ascending melody. Write a counterpoint melody on track v0 with contrary motion (descending when v1 ascends). Use note events with MIDI pitches." "H4" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "H4_counterpoint" "blocked" "No API connection."
      return 0
    fi
    record_result "H4_counterpoint" "warn" "AI prompt did not settle."
    return 0
  fi

  local v0_events v1_events
  v0_events="$(extract_events v0)"
  v1_events="$(extract_events v1)"
  dump_events "H4_counterpoint" "v0" "$v0_events"
  dump_events "H4_counterpoint" "v1" "$v1_events"

  python3 - "$v0_events" "$v1_events" <<'PY'
import json
import sys

v0 = json.loads(sys.argv[1])
v1 = json.loads(sys.argv[2])

v0_notes = sorted([(e['at'], int(e['pitch'])) for e in v0 if e.get('kind') == 'note' and 'pitch' in e])
v1_notes = sorted([(e['at'], int(e['pitch'])) for e in v1 if e.get('kind') == 'note' and 'pitch' in e])

if len(v0_notes) < 3:
    print(f"[H4_counterpoint] Only {len(v0_notes)} notes on v0 — need at least 3.")
    if len(v0_notes) == 0:
        print("[H4_counterpoint] [FN-RISK] No NoteEvents with pitch found on v0.")
    sys.exit(1)

# Check contrary motion: when v1 pitch goes up, v0 should go down (and vice versa)
contrary_count = 0
total_pairs = 0
for i in range(1, len(v0_notes)):
    v0_delta = v0_notes[i][1] - v0_notes[i-1][1]
    # Find corresponding v1 motion (closest positions)
    v1_delta = None
    for j in range(1, len(v1_notes)):
        if v1_notes[j][0] >= v0_notes[i-1][0] and v1_notes[j-1][0] <= v0_notes[i][0]:
            v1_delta = v1_notes[j][1] - v1_notes[j-1][1]
            break
    if v1_delta is None:
        continue
    total_pairs += 1
    if (v0_delta < 0 and v1_delta > 0) or (v0_delta > 0 and v1_delta < 0):
        contrary_count += 1

ratio = contrary_count / total_pairs if total_pairs > 0 else 0
result = "YES" if ratio >= 0.6 else "NO"
print(f"[H4_counterpoint] Assertion: contrary_motion — {contrary_count}/{total_pairs} pairs ({ratio:.0%}) >= 60%? {result}")

sys.exit(0 if ratio >= 0.6 else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "H4_counterpoint" "pass" "Contrary motion >=60% in counterpoint."
  else
    record_result "H4_counterpoint" "fail" "Contrary motion <60%. [FN-RISK: AI may interpret counterpoint differently]"
  fi
}

# ===========================================================================
# RHYTHM
# ===========================================================================

# ---------------------------------------------------------------------------
# R1: Syncopation — "Syncopated hi-hat"
# Expect: <50% on on-beats (steps 0,4,8,12), >=6 events
# ---------------------------------------------------------------------------

scenario_R1_syncopation() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "R1-boot"

  local rc=0
  submit_ai_prompt "Write a syncopated hi-hat pattern on the active track. At least 6 events. Use trigger events." "R1" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "R1_syncopation" "blocked" "No API connection."
      return 0
    fi
    record_result "R1_syncopation" "warn" "AI prompt did not settle."
    return 0
  fi

  local events_json track_id
  for tid in v0 v1 v2 v3; do
    events_json="$(extract_events "$tid")"
    if python3 -c "import json,sys; e=json.loads(sys.argv[1]); sys.exit(0 if isinstance(e,list) and len(e)>=6 else 1)" "$events_json" 2>/dev/null; then
      track_id="$tid"
      break
    fi
  done

  if [[ -z "${track_id:-}" ]]; then
    if check_raised_decision; then
      record_result "R1_syncopation" "warn" "AI raised a decision instead of acting. [FN-RISK]"
      return 0
    fi
    dump_events "R1_syncopation" "v0" "$(extract_events v0)"
    record_result "R1_syncopation" "fail" "No track had >=6 events after syncopation prompt."
    return 0
  fi

  dump_events "R1_syncopation" "$track_id" "$events_json"

  python3 - "$events_json" <<'PY'
import json
import sys

events = json.loads(sys.argv[1])
# Include both trigger and note events
positions = [e['at'] for e in events if e.get('kind') in ('trigger', 'note')]

total = len(positions)
on_beats = {0, 4, 8, 12}
on_beat_count = sum(1 for p in positions if p in on_beats)
on_beat_ratio = on_beat_count / total if total > 0 else 1.0

result_count = "YES" if total >= 6 else "NO"
print(f"[R1_syncopation] Assertion: event_count — {total} events >= 6? {result_count}")

result_sync = "YES" if on_beat_ratio < 0.5 else "NO"
print(f"[R1_syncopation] Assertion: syncopated — {on_beat_count}/{total} on-beat ({on_beat_ratio:.0%}) < 50%? {result_sync}")

sys.exit(0 if (total >= 6 and on_beat_ratio < 0.5) else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "R1_syncopation" "pass" "Syncopated pattern: >=6 events, <50% on-beats."
  else
    record_result "R1_syncopation" "fail" "Syncopation validation failed."
  fi
}

# ---------------------------------------------------------------------------
# R2: Call and response — Seed phrase on v0, prompt v1 response
# Expect: v1 events in complementary positions (not overlapping v0 heavily)
# ---------------------------------------------------------------------------

scenario_R2_call_response() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "R2-boot"

  # Seed a "call" pattern on v0 (first half of bar)
  local seed_events='[
    {"kind":"trigger","at":0,"velocity":0.9},
    {"kind":"trigger","at":1,"velocity":0.7},
    {"kind":"trigger","at":2,"velocity":0.8},
    {"kind":"trigger","at":3,"velocity":0.6}
  ]'
  seed_events "v0" "$seed_events"
  snapshot_page "R2-seeded"

  local rc=0
  submit_ai_prompt "Track v0 has a rhythmic phrase on steps 0-3 (first half). Write a response pattern on track v1 that fills the second half (steps 8-15). Use trigger events." "R2" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "R2_call_response" "blocked" "No API connection."
      return 0
    fi
    record_result "R2_call_response" "warn" "AI prompt did not settle."
    return 0
  fi

  local v0_events v1_events
  v0_events="$(extract_events v0)"
  v1_events="$(extract_events v1)"
  dump_events "R2_call_response" "v0" "$v0_events"
  dump_events "R2_call_response" "v1" "$v1_events"

  python3 - "$v0_events" "$v1_events" <<'PY'
import json
import sys

v0 = json.loads(sys.argv[1])
v1 = json.loads(sys.argv[2])

v1_positions = set(e['at'] for e in v1 if e.get('kind') in ('trigger', 'note'))
v0_positions = set(e['at'] for e in v0 if e.get('kind') in ('trigger', 'note'))

v1_count = len(v1_positions)
result_count = "YES" if v1_count >= 2 else "NO"
print(f"[R2_call_response] Assertion: v1_events — {v1_count} distinct positions >= 2? {result_count}")

# Check complementary: v1 events should mostly be outside v0's positions
overlap = v1_positions & v0_positions
complementary_ratio = 1.0 - (len(overlap) / v1_count) if v1_count > 0 else 0
result_comp = "YES" if complementary_ratio >= 0.5 else "NO"
print(f"[R2_call_response] Assertion: complementary — {complementary_ratio:.0%} of v1 positions outside v0 >= 50%? {result_comp}")

# Check that at least some v1 events are in the second half (steps 8-15)
second_half = {p for p in v1_positions if p >= 8}
result_half = "YES" if len(second_half) >= 1 else "NO"
print(f"[R2_call_response] Assertion: second_half — {len(second_half)} v1 events in steps 8-15 >= 1? {result_half}")

sys.exit(0 if (v1_count >= 2 and complementary_ratio >= 0.5) else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "R2_call_response" "pass" "Call-response: v1 in complementary positions."
  else
    record_result "R2_call_response" "fail" "Call-response validation failed."
  fi
}

# ---------------------------------------------------------------------------
# R3: Polyrhythm — "3-against-4 polyrhythm"
# Expect: one track groups of 4, other groups of 3
# ---------------------------------------------------------------------------

scenario_R3_polyrhythm() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "R3-boot"

  local rc=0
  submit_ai_prompt "Write a 3-against-4 polyrhythm. Put 4 evenly-spaced trigger events on track v0 and 3 evenly-spaced trigger events on track v1. Use 16 steps total." "R3" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "R3_polyrhythm" "blocked" "No API connection."
      return 0
    fi
    record_result "R3_polyrhythm" "warn" "AI prompt did not settle."
    return 0
  fi

  local v0_events v1_events
  v0_events="$(extract_events v0)"
  v1_events="$(extract_events v1)"
  dump_events "R3_polyrhythm" "v0" "$v0_events"
  dump_events "R3_polyrhythm" "v1" "$v1_events"

  python3 - "$v0_events" "$v1_events" <<'PY'
import json
import sys

v0 = json.loads(sys.argv[1])
v1 = json.loads(sys.argv[2])

v0_positions = sorted(set(e['at'] for e in v0 if e.get('kind') in ('trigger', 'note')))
v1_positions = sorted(set(e['at'] for e in v1 if e.get('kind') in ('trigger', 'note')))

# Check: one track has ~4 events, the other ~3
counts = sorted([len(v0_positions), len(v1_positions)])

# Accept 3-and-4 in either order, with some tolerance
has_3 = any(c in (3,) for c in counts)
has_4 = any(c in (4,) for c in counts)
poly_correct = has_3 and has_4

# Also accept: one has 3, other has 4 (or multiples thereof)
if not poly_correct:
    poly_correct = (counts[0] % 3 == 0 and counts[1] % 4 == 0) or (counts[0] % 4 == 0 and counts[1] % 3 == 0)

result = "YES" if poly_correct else "NO"
print(f"[R3_polyrhythm] Assertion: grouping — v0={len(v0_positions)} v1={len(v1_positions)} events, 3-against-4 pattern? {result}")

# Check spacing evenness for each track
def check_even(positions, expected_count, label):
    if len(positions) < 2:
        print(f"[R3_polyrhythm] {label}: too few events to check spacing")
        return False
    diffs = [positions[i+1] - positions[i] for i in range(len(positions)-1)]
    avg_diff = sum(diffs) / len(diffs)
    max_dev = max(abs(d - avg_diff) for d in diffs)
    even = max_dev <= 1.5  # tolerance of 1.5 steps
    result = "YES" if even else "NO"
    print(f"[R3_polyrhythm] Assertion: {label}_even_spacing — max deviation {max_dev:.1f} steps <= 1.5? {result}")
    return even

even_v0 = check_even(v0_positions, len(v0_positions), "v0")
even_v1 = check_even(v1_positions, len(v1_positions), "v1")

sys.exit(0 if poly_correct else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "R3_polyrhythm" "pass" "3-against-4 polyrhythm: correct grouping."
  else
    record_result "R3_polyrhythm" "fail" "3-against-4 polyrhythm validation failed."
  fi
}

# ===========================================================================
# COMBINED
# ===========================================================================

# ---------------------------------------------------------------------------
# M1: Walking bass — "Walking bass in F major"
# Expect: ~1 note/beat, F major pitches, stepwise motion >=60%
# ---------------------------------------------------------------------------

scenario_M1_walking_bass() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "M1-boot"

  local rc=0
  submit_ai_prompt "Write a walking bass line in F major on the active track. Roughly one note per beat (every 4 steps). Use note events with MIDI pitches. Stepwise motion preferred." "M1" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "M1_walking_bass" "blocked" "No API connection."
      return 0
    fi
    record_result "M1_walking_bass" "warn" "AI prompt did not settle."
    return 0
  fi

  local events_json track_id
  for tid in v0 v1 v2 v3; do
    events_json="$(extract_events "$tid")"
    if python3 -c "import json,sys; e=json.loads(sys.argv[1]); sys.exit(0 if isinstance(e,list) and len(e)>=3 else 1)" "$events_json" 2>/dev/null; then
      track_id="$tid"
      break
    fi
  done

  if [[ -z "${track_id:-}" ]]; then
    if check_raised_decision; then
      record_result "M1_walking_bass" "warn" "AI raised a decision instead of acting. [FN-RISK]"
      return 0
    fi
    dump_events "M1_walking_bass" "v0" "$(extract_events v0)"
    record_result "M1_walking_bass" "fail" "No track had >=3 events after walking bass prompt."
    return 0
  fi

  dump_events "M1_walking_bass" "$track_id" "$events_json"

  python3 - "$events_json" <<'PY'
import json
import sys

events = json.loads(sys.argv[1])
notes = sorted([(e['at'], int(e['pitch'])) for e in events if e.get('kind') == 'note' and 'pitch' in e])

if len(notes) < 3:
    print(f"[M1_walking_bass] Only {len(notes)} notes — need at least 3.")
    if len(notes) == 0:
        print("[M1_walking_bass] [FN-RISK] No NoteEvents with pitch found.")
    sys.exit(1)

pitches = [n[1] for n in notes]

# F major: F G A Bb C D E = {5, 7, 9, 10, 0, 2, 4}
f_major_mod12 = {5, 7, 9, 10, 0, 2, 4}
pitch_classes = {p % 12 for p in pitches}
all_in_fmaj = pitch_classes.issubset(f_major_mod12)
outliers = pitch_classes - f_major_mod12

result_scale = "YES" if all_in_fmaj else "NO"
print(f"[M1_walking_bass] Assertion: f_major_pitches — pitch classes {pitch_classes} all in F major? {result_scale}" + (f" outliers={outliers}" if outliers else ""))

# Stepwise motion: interval <= 2 semitones between consecutive notes
stepwise_count = 0
for i in range(1, len(pitches)):
    interval = abs(pitches[i] - pitches[i-1])
    if interval <= 2:
        stepwise_count += 1

total_intervals = len(pitches) - 1
stepwise_ratio = stepwise_count / total_intervals if total_intervals > 0 else 0
result_step = "YES" if stepwise_ratio >= 0.6 else "NO"
print(f"[M1_walking_bass] Assertion: stepwise_motion — {stepwise_count}/{total_intervals} ({stepwise_ratio:.0%}) >= 60%? {result_step}")

# Roughly 1 note per beat: positions should be roughly every 4 steps
positions = [n[0] for n in notes]
if len(positions) >= 2:
    diffs = [positions[i+1] - positions[i] for i in range(len(positions)-1)]
    avg_spacing = sum(diffs) / len(diffs)
    beat_like = 2.0 <= avg_spacing <= 6.0
    result_beat = "YES" if beat_like else "NO"
    print(f"[M1_walking_bass] Assertion: beat_spacing — avg spacing {avg_spacing:.1f} steps in [2.0, 6.0]? {result_beat}")

sys.exit(0 if (all_in_fmaj and stepwise_ratio >= 0.6) else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "M1_walking_bass" "pass" "Walking bass: F major pitches, >=60% stepwise motion."
  else
    record_result "M1_walking_bass" "fail" "Walking bass validation failed."
  fi
}

# ---------------------------------------------------------------------------
# M2: Melodic sequence — Seed 4-note motif, prompt transposition
# Expect: pitches shifted by correct interval
# ---------------------------------------------------------------------------

scenario_M2_melodic_sequence() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "M2-boot"

  # Seed a 4-note motif on v1: C D E G (60, 62, 64, 67)
  set_melodic_engine "v1"
  local seed_events='[
    {"kind":"note","at":0,"pitch":60,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":2,"pitch":62,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":4,"pitch":64,"velocity":0.8,"duration":0.25},
    {"kind":"note","at":6,"pitch":67,"velocity":0.8,"duration":0.25}
  ]'
  seed_events "v1" "$seed_events"
  snapshot_page "M2-seeded"

  local rc=0
  submit_ai_prompt "Track v1 has a 4-note motif (C D E G at steps 0,2,4,6). Transpose this motif up by a major 3rd (4 semitones) and write it on track v0 starting at step 0. Use note events with MIDI pitches." "M2" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "M2_melodic_sequence" "blocked" "No API connection."
      return 0
    fi
    record_result "M2_melodic_sequence" "warn" "AI prompt did not settle."
    return 0
  fi

  local v0_events
  v0_events="$(extract_events v0)"
  dump_events "M2_melodic_sequence" "v0" "$v0_events"

  python3 - "$v0_events" <<'PY'
import json
import sys

events = json.loads(sys.argv[1])
notes = sorted([(e['at'], int(e['pitch'])) for e in events if e.get('kind') == 'note' and 'pitch' in e])

if len(notes) < 4:
    print(f"[M2_melodic_sequence] Only {len(notes)} notes — need at least 4.")
    if len(notes) == 0:
        print("[M2_melodic_sequence] [FN-RISK] No NoteEvents with pitch found.")
    sys.exit(1)

pitches = [n[1] for n in notes[:4]]
# Expected: C D E G transposed up 4 semitones = E F# G# B = 64 66 68 71
expected = [64, 66, 68, 71]

# Check if pitches match expected transposition
exact_match = pitches == expected
print(f"[M2_melodic_sequence] Assertion: exact_transposition — {pitches} == {expected}? {'YES' if exact_match else 'NO'}")

# Check interval preservation (relative intervals should be same: +2, +2, +3)
if len(pitches) >= 4:
    actual_intervals = [pitches[i+1] - pitches[i] for i in range(3)]
    expected_intervals = [2, 2, 3]
    intervals_match = actual_intervals == expected_intervals
    print(f"[M2_melodic_sequence] Assertion: interval_preservation — intervals {actual_intervals} == {expected_intervals}? {'YES' if intervals_match else 'NO'}")
else:
    intervals_match = False

# Check transposition amount (first note should be original + 4)
first_offset = pitches[0] - 60
offset_correct = first_offset == 4
print(f"[M2_melodic_sequence] Assertion: transposition_offset — first note offset {first_offset} == 4? {'YES' if offset_correct else 'NO'}")

# Pass if either exact match or intervals preserved with correct offset
sys.exit(0 if (exact_match or (intervals_match and offset_correct)) else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "M2_melodic_sequence" "pass" "Melodic sequence: correct transposition by major 3rd."
  else
    record_result "M2_melodic_sequence" "fail" "Melodic sequence transposition validation failed."
  fi
}

# ---------------------------------------------------------------------------
# M3: Arpeggiated chord — "Arpeggiate Am7 in even 16ths"
# Expect: Am7 pitches (A C E G = 9,0,4,7 mod 12), evenly spaced, >=8 events
# ---------------------------------------------------------------------------

scenario_M3_arp_chord() {
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "M3-boot"

  local rc=0
  submit_ai_prompt "Arpeggiate an Am7 chord in even 16th notes on the active track. At least 8 notes. Use note events with MIDI pitches. Am7 = A C E G." "M3" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$rc" -eq 2 ]]; then
      record_result "M3_arp_chord" "blocked" "No API connection."
      return 0
    fi
    record_result "M3_arp_chord" "warn" "AI prompt did not settle."
    return 0
  fi

  local events_json track_id
  for tid in v0 v1 v2 v3; do
    events_json="$(extract_events "$tid")"
    if python3 -c "import json,sys; e=json.loads(sys.argv[1]); sys.exit(0 if isinstance(e,list) and len(e)>=8 else 1)" "$events_json" 2>/dev/null; then
      track_id="$tid"
      break
    fi
  done

  if [[ -z "${track_id:-}" ]]; then
    if check_raised_decision; then
      record_result "M3_arp_chord" "warn" "AI raised a decision instead of acting. [FN-RISK]"
      return 0
    fi
    dump_events "M3_arp_chord" "v0" "$(extract_events v0)"
    record_result "M3_arp_chord" "fail" "No track had >=8 events after Am7 arpeggio prompt."
    return 0
  fi

  dump_events "M3_arp_chord" "$track_id" "$events_json"

  python3 - "$events_json" <<'PY'
import json
import sys

events = json.loads(sys.argv[1])
notes = sorted([(e['at'], int(e['pitch'])) for e in events if e.get('kind') == 'note' and 'pitch' in e])

if len(notes) < 8:
    print(f"[M3_arp_chord] Only {len(notes)} notes — need at least 8.")
    if len(notes) == 0:
        print("[M3_arp_chord] [FN-RISK] No NoteEvents with pitch found.")
    sys.exit(1)

pitches = [n[1] for n in notes]
positions = [n[0] for n in notes]

# Am7: A=9, C=0, E=4, G=7
am7_mod12 = {9, 0, 4, 7}
pitch_classes = {p % 12 for p in pitches}
all_in_am7 = pitch_classes.issubset(am7_mod12)
outliers = pitch_classes - am7_mod12

result_chord = "YES" if all_in_am7 else "NO"
print(f"[M3_arp_chord] Assertion: am7_pitches — pitch classes {pitch_classes} all in Am7 {{9,0,4,7}}? {result_chord}" + (f" outliers={outliers}" if outliers else ""))

result_count = "YES" if len(notes) >= 8 else "NO"
print(f"[M3_arp_chord] Assertion: event_count — {len(notes)} notes >= 8? {result_count}")

# Check even spacing
if len(positions) >= 2:
    diffs = [positions[i+1] - positions[i] for i in range(len(positions)-1)]
    avg_diff = sum(diffs) / len(diffs)
    max_dev = max(abs(d - avg_diff) for d in diffs) if diffs else 0
    even = max_dev <= 0.5  # tight tolerance for "even 16ths"
    result_even = "YES" if even else "NO"
    print(f"[M3_arp_chord] Assertion: even_spacing — max deviation {max_dev:.2f} steps <= 0.5? {result_even}")
else:
    even = False

sys.exit(0 if (all_in_am7 and len(notes) >= 8) else 1)
PY
  local py_rc=$?

  if [[ "$py_rc" -eq 0 ]]; then
    record_result "M3_arp_chord" "pass" "Am7 arpeggio: correct pitches, >=8 events."
  else
    record_result "M3_arp_chord" "fail" "Am7 arpeggio validation failed."
  fi
}

# ===========================================================================
# Runner
# ===========================================================================

printf 'scenario\tresult\tnotes\n' >"$OUT_DIR/results.tsv"

echo "Musical competence run id: $RUN_ID"
echo "Base URL: $BASE_URL"
echo "Artifacts: $OUT_DIR"

if [[ -n "${QA_SCENARIOS:-}" ]]; then
  for scenario in $QA_SCENARIOS; do
    "$scenario" || true
  done
else
  scenario_boot || { echo "Boot failed — skipping musical scenarios."; exit 1; }

  # Pitch & Harmony
  scenario_H1_arpeggio || true
  scenario_H2_scale_melody || true
  scenario_H3_chord_progression || true
  scenario_H4_counterpoint || true

  # Rhythm
  scenario_R1_syncopation || true
  scenario_R2_call_response || true
  scenario_R3_polyrhythm || true

  # Combined
  scenario_M1_walking_bass || true
  scenario_M2_melodic_sequence || true
  scenario_M3_arp_chord || true
fi

echo
echo "Musical competence run complete. Results: $OUT_DIR/results.tsv"

# Result semantics (same as smoke):
#   pass       — scenario verified the expected behavior
#   fail       — scenario detected a regression or missing behavior
#   reproduces — scenario detected a known issue that is still present
#   warn       — scenario ran but could not confirm expected behavior (inconclusive)
#   blocked    — scenario could not run due to missing prerequisites
if awk -F'\t' 'NR > 1 && ($2 == "fail" || $2 == "reproduces") { found = 1 } END { exit(found ? 0 : 1) }' "$OUT_DIR/results.tsv"; then
  exit 1
fi
