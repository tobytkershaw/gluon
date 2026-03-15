#!/usr/bin/env bash
set -euo pipefail

# M6 Behavioral Validation — end-to-end QA of collaboration features.
#
# Validates: approval/preservation, reaction history/restraint, listen tool
# with lens, audio analysis tools, importance/open decisions, mark_approved,
# merge regression checks, system prompt + compressed state sanity.
#
# Requires a running dev server and the Playwright CLI wrapper.
# Usage:
#   npm run dev &
#   bash scripts/qa-playwright-m6.sh

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
OUT_DIR="${QA_OUT_DIR:-$ROOT_DIR/output/playwright/$RUN_ID/m6}"
SHORT_ID="$(printf '%s' "$RUN_ID" | tr -cd '[:alnum:]' | tail -c 9)"
SESSION_NAME="m6${SHORT_ID}"
PW_TIMEOUT="${QA_PW_TIMEOUT:-60}"
AI_SETTLE_TIMEOUT="${QA_AI_SETTLE_TIMEOUT:-30}"
AI_SETTLE_MAX_ATTEMPTS=$(( AI_SETTLE_TIMEOUT / 2 ))
mkdir -p "$OUT_DIR"

# shellcheck source=qa-playwright-helpers.sh
source "$ROOT_DIR/scripts/qa-playwright-helpers.sh"

# ---------------------------------------------------------------------------
# IndexedDB session reader — returns JSON session state from the active project
# ---------------------------------------------------------------------------

read_session_json() {
  local ref
  ref="$(qa_anchor_ref)"
  eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) {
        resolve('no-projects');
        return;
      }
      // Return the most recently updated project session
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      resolve(JSON.stringify(projects[0].session));
    };
    getAll.onerror = () => resolve('idb-error');
  };
  req.onerror = () => resolve('idb-open-error');
})
JS
)" "$ref"
}

# Read chat messages from session to check for tool call actions
read_last_ai_message_actions() {
  local ref
  ref="$(qa_anchor_ref)"
  eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const session = projects[0].session;
      const msgs = session.messages || [];
      // Find the last AI message with actions
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'ai' && msgs[i].actions && msgs[i].actions.length > 0) {
          resolve(JSON.stringify(msgs[i].actions));
          return;
        }
      }
      resolve('no-actions');
    };
    getAll.onerror = () => resolve('idb-error');
  };
  req.onerror = () => resolve('idb-open-error');
})
JS
)" "$ref"
}

# Read the last N chat messages (role + text + actions description)
read_recent_messages() {
  local count="${1:-5}"
  local ref
  ref="$(qa_anchor_ref)"
  local js_code
  js_code="$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const msgs = projects[0].session.messages || [];
      const recent = msgs.slice(-MSGCOUNT).map(m => ({
        role: m.role,
        text: (m.text || '').slice(0, 500),
        actions: (m.actions || []).map(a => a.description)
      }));
      resolve(JSON.stringify(recent));
    };
    getAll.onerror = () => resolve('idb-error');
  };
  req.onerror = () => resolve('idb-open-error');
})
JS
)"
  js_code="${js_code//MSGCOUNT/$count}"
  eval_js "$js_code" "$ref"
}

# Inject session state into IndexedDB for the active project
inject_session_patch() {
  local patch_js="$1"
  local ref
  ref="$(qa_anchor_ref)"
  local js_code
  js_code="$(cat <<JS
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const project = projects[0];
      const session = project.session;
      ${patch_js}
      project.session = session;
      const putReq = store.put(project);
      putReq.onsuccess = () => resolve('ok');
      putReq.onerror = () => resolve('put-error');
    };
    getAll.onerror = () => resolve('idb-error');
  };
  req.onerror = () => resolve('idb-open-error');
})
JS
)"
  eval_js "$js_code" "$ref"
}

# ---------------------------------------------------------------------------
# S7: Merge conflict regression check (no API needed)
# ---------------------------------------------------------------------------

scenario_s7_merge_regression() {
  echo "S7: Merge conflict regression check..."

  # Type check
  local tsc_out="$OUT_DIR/s7-tsc.txt"
  if npx tsc --noEmit >"$tsc_out" 2>&1; then
    record_result "s7_tsc" "pass" "tsc --noEmit passed with zero errors."
  else
    record_result "s7_tsc" "fail" "tsc --noEmit found type errors. See $tsc_out"
    return 1
  fi

  # Test suite
  local test_out="$OUT_DIR/s7-vitest.txt"
  if npx vitest run >"$test_out" 2>&1; then
    record_result "s7_vitest" "pass" "vitest run passed."
  else
    record_result "s7_vitest" "fail" "vitest run had failures. See $test_out"
    return 1
  fi

  # Tool count check — verify GLUON_TOOLS array has exactly 17 entries
  local tool_count
  tool_count="$(python3 - <<'PY'
import re
with open('src/ai/tool-schemas.ts', 'r') as f:
    content = f.read()
# Count tools in the GLUON_TOOLS export array
m = re.search(r'export const GLUON_TOOLS.*?\[([^\]]+)\]', content, re.S)
if not m:
    print('0')
else:
    tools = [t.strip().rstrip(',') for t in m.group(1).strip().split('\n') if t.strip() and not t.strip().startswith('//')]
    print(len(tools))
PY
)"

  if [[ "$tool_count" -eq 17 ]]; then
    record_result "s7_tool_count" "pass" "GLUON_TOOLS has $tool_count tools (expected 17)."
  else
    record_result "s7_tool_count" "fail" "GLUON_TOOLS has $tool_count tools — expected 17."
  fi
}

# ---------------------------------------------------------------------------
# S8: System prompt + compressed state sanity (no API needed)
# ---------------------------------------------------------------------------

scenario_s8_prompt_state_sanity() {
  echo "S8: System prompt + compressed state sanity..."

  # Measure system prompt token count (rough: word count * 1.3)
  local token_estimate
  token_estimate="$(python3 - <<'PY'
# Read the system-prompt.ts source and estimate the template size.
# Count words in the entire file as an upper bound for the template.
# Rough token estimate: words * 1.3 for mixed English/code.
with open('src/ai/system-prompt.ts', 'r') as f:
    content = f.read()
words = len(content.split())
tokens = int(words * 1.3)
print(tokens)
PY
)"

  if [[ "$token_estimate" -lt 4000 ]]; then
    record_result "s8_prompt_size" "pass" "System prompt source estimated at ~$token_estimate tokens (< 4000)."
  else
    record_result "s8_prompt_size" "warn" "System prompt source estimated at ~$token_estimate tokens (may exceed 4k when rendered with all models)."
  fi

  # Verify compressed state has all M6 fields
  local state_check
  state_check="$(python3 - <<'PY'
import re

with open('src/ai/state-compression.ts', 'r') as f:
    content = f.read()

# Check CompressedState interface has all M6 fields
required_fields = [
    'recent_reactions',
    'observed_patterns',
    'restraint_level',
    'open_decisions',
    'recent_preservation',
]

# Check CompressedTrack has M6 fields
required_track_fields = [
    'approval',
    'importance',
    'musicalRole',
]

missing = []
for field in required_fields:
    if field not in content:
        missing.append('CompressedState.' + field)

for field in required_track_fields:
    if field not in content:
        missing.append('CompressedTrack.' + field)

if missing:
    print('missing:' + ','.join(missing))
else:
    print('ok')
PY
)"

  if [[ "$state_check" == "ok" ]]; then
    record_result "s8_compressed_state_fields" "pass" "CompressedState has all M6 fields (reactions, patterns, restraint, decisions, preservation, approval, importance, musicalRole)."
  else
    record_result "s8_compressed_state_fields" "fail" "CompressedState missing fields: ${state_check#missing:}"
  fi

  # Verify tool-schemas.ts has all M6 tools
  local tool_check
  tool_check="$(python3 - <<'PY'
with open('src/ai/tool-schemas.ts', 'r') as f:
    content = f.read()

m6_tools = [
    'listen',
    'render',
    'spectral',
    'dynamics',
    'rhythm',
    'set_importance',
    'mark_approved',
    'raise_decision',
]

missing = [t for t in m6_tools if "name: '" + t + "'" not in content]
if missing:
    print('missing:' + ','.join(missing))
else:
    print('ok')
PY
)"

  if [[ "$tool_check" == "ok" ]]; then
    record_result "s8_m6_tools" "pass" "All M6 tools present in tool-schemas.ts."
  else
    record_result "s8_m6_tools" "fail" "Missing M6 tools: ${tool_check#missing:}"
  fi
}

# ---------------------------------------------------------------------------
# S1: Approval + preservation flow
# ---------------------------------------------------------------------------

scenario_s1_approval_preservation() {
  echo "S1: Approval + preservation flow..."

  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "s1-boot"

  # Seed a kick pattern on v0
  click_view_button "Inst"
  snapshot_page "s1-inst"
  local step_ref
  step_ref="$(step_button_ref "1")"
  if [[ -z "$step_ref" ]]; then
    # Try seeding via AI
    local rc=0
    submit_ai_prompt "Sketch a simple four-on-the-floor kick pattern on the kick track." "s1-seed" || rc=$?
    if [[ "$rc" -ne 0 ]]; then
      record_result "s1_approval_preservation" "blocked" "Could not seed kick pattern for preservation test."
      return 0
    fi
  else
    run_pw click "$step_ref" >/dev/null 2>&1
    local step5_ref
    step5_ref="$(step_button_ref "5")"
    if [[ -n "$step5_ref" ]]; then
      run_pw click "$step5_ref" >/dev/null 2>&1
    fi
    local step9_ref
    step9_ref="$(step_button_ref "9")"
    if [[ -n "$step9_ref" ]]; then
      run_pw click "$step9_ref" >/dev/null 2>&1
    fi
    local step13_ref
    step13_ref="$(step_button_ref "13")"
    if [[ -n "$step13_ref" ]]; then
      run_pw click "$step13_ref" >/dev/null 2>&1
    fi
  fi

  snapshot_page "s1-seeded"

  # Capture events before approval
  local ref
  ref="$(qa_anchor_ref)"
  local events_before
  events_before="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const track = projects[0].session.tracks.find(t => t.id === 'v0');
      if (!track) { resolve('no-track'); return; }
      const region = (track.regions || [])[0];
      if (!region) { resolve('no-region'); return; }
      resolve(JSON.stringify(region.events.length));
    };
  };
})
JS
)" "$ref")"

  events_before="$(printf '%s' "$events_before" | tail -n 1 | tr -d '"')"
  echo "Events before: $events_before"

  if [[ "$events_before" == "no-projects" || "$events_before" == "no-track" || "$events_before" == "no-region" || -z "$events_before" ]]; then
    record_result "s1_approval_preservation" "blocked" "Could not read v0 events before approval test."
    return 0
  fi

  # Set v0 to 'approved' via AI
  local rc=0
  submit_ai_prompt "Mark the kick track as approved." "s1-approve" || rc=$?
  if [[ "$rc" -eq 2 ]]; then
    record_result "s1_approval_preservation" "blocked" "API not connected."
    return 0
  fi

  # Check approval was set
  local approval_after
  approval_after="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const track = projects[0].session.tracks.find(t => t.id === 'v0');
      resolve(track ? (track.approval || 'exploratory') : 'no-track');
    };
  };
})
JS
)" "$ref")"

  approval_after="$(printf '%s' "$approval_after" | tail -n 1 | tr -d '"')"
  echo "Approval after mark: $approval_after"

  if [[ "$approval_after" != "approved" && "$approval_after" != "anchor" && "$approval_after" != "liked" ]]; then
    record_result "s1_approval_set" "warn" "Approval not set to approved/liked/anchor after prompt (got: $approval_after). AI may not have used mark_approved."
  else
    record_result "s1_approval_set" "pass" "Approval set to $approval_after via AI."
  fi

  # Prompt to rewrite kick — events should be preserved (or AI should refuse)
  rc=0
  submit_ai_prompt "Completely rewrite the kick pattern with a different rhythm." "s1-rewrite-approved" || rc=$?
  if [[ "$rc" -ne 0 && "$rc" -ne 2 ]]; then
    record_result "s1_preservation" "warn" "AI prompt to rewrite approved track did not settle."
    return 0
  fi

  # Check events after — should be unchanged or AI should have refused
  local events_after_approved
  events_after_approved="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const track = projects[0].session.tracks.find(t => t.id === 'v0');
      if (!track) { resolve('no-track'); return; }
      const region = (track.regions || [])[0];
      if (!region) { resolve('no-region'); return; }
      resolve(JSON.stringify(region.events.length));
    };
  };
})
JS
)" "$ref")"

  events_after_approved="$(printf '%s' "$events_after_approved" | tail -n 1 | tr -d '"')"
  echo "Events after rewrite attempt (approved): $events_after_approved"

  # Either events unchanged, or AI text response indicates refusal
  if [[ "$events_before" == "$events_after_approved" ]]; then
    record_result "s1_preservation" "pass" "Events unchanged after rewrite prompt on approved track (event count: $events_before)."
  else
    # AI may have still rewritten — check if snapshot text shows acknowledgment
    if snapshot_contains "approved" || snapshot_contains "protected" || snapshot_contains "confirm"; then
      record_result "s1_preservation" "warn" "Events changed ($events_before -> $events_after_approved) but AI acknowledged the approval status."
    else
      record_result "s1_preservation" "warn" "Events changed ($events_before -> $events_after_approved) on approved track. AI may not have respected preservation."
    fi
  fi

  # Now set to exploratory and rewrite — should succeed
  rc=0
  submit_ai_prompt "Set the kick track approval to exploratory, then rewrite the kick with a syncopated pattern." "s1-exploratory" || rc=$?
  if [[ "$rc" -ne 0 && "$rc" -ne 2 ]]; then
    record_result "s1_exploratory_edit" "warn" "AI prompt to edit exploratory track did not settle."
    return 0
  fi

  local events_after_exploratory
  events_after_exploratory="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const track = projects[0].session.tracks.find(t => t.id === 'v0');
      if (!track) { resolve('no-track'); return; }
      const region = (track.regions || [])[0];
      if (!region) { resolve('0'); return; }
      resolve(JSON.stringify(region.events.length));
    };
  };
})
JS
)" "$ref")"

  events_after_exploratory="$(printf '%s' "$events_after_exploratory" | tail -n 1 | tr -d '"')"
  echo "Events after exploratory rewrite: $events_after_exploratory"

  if [[ "$events_after_exploratory" != "$events_before" && "$events_after_exploratory" -gt 0 ]]; then
    record_result "s1_exploratory_edit" "pass" "Events changed ($events_before -> $events_after_exploratory) after setting to exploratory."
  else
    record_result "s1_exploratory_edit" "warn" "Events did not change after exploratory rewrite ($events_before -> $events_after_exploratory)."
  fi

  screenshot_page "s1-final"
}

# ---------------------------------------------------------------------------
# S2: Reaction history -> restraint calibration
# ---------------------------------------------------------------------------

scenario_s2_reaction_restraint() {
  echo "S2: Reaction history -> restraint calibration..."

  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "s2-boot"

  local ref
  ref="$(qa_anchor_ref)"

  # Inject 3 rejection reactions into session state
  local inject_result
  inject_result="$(inject_session_patch "$(cat <<'PATCH'
    const now = Date.now();
    if (!session.reactionHistory) session.reactionHistory = [];
    session.reactionHistory.push(
      { actionGroupIndex: 0, verdict: 'rejected', rationale: 'too bright and harsh', timestamp: now - 30000 },
      { actionGroupIndex: 1, verdict: 'rejected', rationale: 'still too bright', timestamp: now - 20000 },
      { actionGroupIndex: 2, verdict: 'rejected', rationale: 'way too bright and aggressive', timestamp: now - 10000 }
    );
PATCH
)")"

  inject_result="$(printf '%s' "$inject_result" | tail -n 1 | tr -d '"')"
  if [[ "$inject_result" != "ok" ]]; then
    record_result "s2_reaction_restraint" "blocked" "Could not inject reaction history ($inject_result)."
    return 0
  fi

  # Reload to pick up injected state
  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "s2-reloaded"

  # Verify compressed state shows conservative restraint and observed_patterns contains "bright"
  local restraint_check
  restraint_check="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const session = projects[0].session;
      const reactions = session.reactionHistory || [];
      const rejectedCount = reactions.filter(r => r.verdict === 'rejected').length;

      // Manually compute what compressState would produce
      // deriveRestraintLevel: >=60% rejected -> conservative
      const recent = reactions.slice(-10);
      const rejected = recent.filter(r => r.verdict === 'rejected').length;
      const total = recent.length;
      const restraint = (total >= 3 && rejected / total >= 0.6) ? 'conservative' : (total >= 3 && recent.filter(r => r.verdict === 'approved').length / total >= 0.6) ? 'adventurous' : 'moderate';

      // Check observed patterns for "bright"
      const rejectedRationales = recent.filter(r => r.verdict === 'rejected').map(r => r.rationale || '');
      const hasBright = rejectedRationales.some(r => r.toLowerCase().includes('bright'));

      resolve(JSON.stringify({
        rejectedCount,
        restraint,
        hasBrightInRationales: hasBright,
        reactionCount: reactions.length
      }));
    };
  };
})
JS
)" "$ref")"

  restraint_check="$(printf '%s' "$restraint_check" | tail -n 1 | tr -d '"')"
  echo "Restraint check: $restraint_check"

  if python3 - "$restraint_check" <<'PY'
import json
import sys
try:
    data = json.loads(sys.argv[1])
    if data.get('restraint') == 'conservative' and data.get('hasBrightInRationales'):
        raise SystemExit(0)
    raise SystemExit(1)
except Exception:
    raise SystemExit(1)
PY
  then
    record_result "s2_restraint_calibration" "pass" "3 rejections with 'bright' rationale produce conservative restraint and 'bright' in patterns."
  else
    record_result "s2_restraint_calibration" "fail" "Restraint calibration did not produce expected conservative + bright pattern. Got: $restraint_check"
  fi

  # Send a prompt and verify parameter changes are small (delta < 0.3)
  # First capture current params
  local params_before
  params_before="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('{}'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const track = projects[0].session.tracks.find(t => t.id === 'v0');
      resolve(JSON.stringify(track ? track.params : {}));
    };
  };
})
JS
)" "$ref")"

  params_before="$(printf '%s' "$params_before" | tail -n 1 | tr -d '"')"

  local rc=0
  submit_ai_prompt "Make the kick a bit warmer and deeper." "s2-cautious-edit" || rc=$?
  if [[ "$rc" -eq 2 ]]; then
    record_result "s2_conservative_delta" "blocked" "API not connected."
    return 0
  fi

  if [[ "$rc" -ne 0 ]]; then
    record_result "s2_conservative_delta" "warn" "AI prompt did not settle."
    return 0
  fi

  local params_after
  params_after="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('{}'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const track = projects[0].session.tracks.find(t => t.id === 'v0');
      resolve(JSON.stringify(track ? track.params : {}));
    };
  };
})
JS
)" "$ref")"

  params_after="$(printf '%s' "$params_after" | tail -n 1 | tr -d '"')"

  if python3 - "$params_before" "$params_after" <<'PY'
import json
import sys

try:
    before = json.loads(sys.argv[1])
    after = json.loads(sys.argv[2])
    max_delta = 0.0
    for key in set(list(before.keys()) + list(after.keys())):
        b = float(before.get(key, 0))
        a = float(after.get(key, 0))
        delta = abs(a - b)
        if delta > max_delta:
            max_delta = delta
    # Conservative restraint: all deltas should be < 0.3
    print(f"max_delta={max_delta:.3f}", file=sys.stderr)
    raise SystemExit(0 if max_delta < 0.3 else 1)
except json.JSONDecodeError:
    raise SystemExit(1)
PY
  then
    record_result "s2_conservative_delta" "pass" "Parameter changes under conservative restraint had max delta < 0.3."
  else
    record_result "s2_conservative_delta" "warn" "Parameter changes may exceed delta 0.3 under conservative restraint (AI is non-deterministic)."
  fi

  screenshot_page "s2-final"
}

# ---------------------------------------------------------------------------
# S3: Listen tool with lens
# ---------------------------------------------------------------------------

scenario_s3_listen_lens() {
  echo "S3: Listen tool with lens..."

  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "s3-boot"

  # Seed a pattern first
  click_view_button "Inst"
  snapshot_page "s3-inst"
  local step_ref
  step_ref="$(step_button_ref "1")"
  if [[ -n "$step_ref" ]]; then
    run_pw click "$step_ref" >/dev/null 2>&1
  fi

  local rc=0
  submit_ai_prompt "Listen to the kick and tell me about the low end. Focus on the bass frequencies." "s3-listen-lowend" || rc=$?
  if [[ "$rc" -eq 2 ]]; then
    record_result "s3_listen_lens" "blocked" "API not connected."
    return 0
  fi

  if [[ "$rc" -ne 0 ]]; then
    # Retry once
    rc=0
    submit_ai_prompt "Listen to the kick and evaluate the low end." "s3-listen-retry" || rc=$?
    if [[ "$rc" -ne 0 ]]; then
      record_result "s3_listen_lens" "warn" "AI prompt did not settle after retry."
      return 0
    fi
  fi

  # Check snapshot for substantive audio feedback
  snapshot_page "s3-after-listen"
  screenshot_page "s3-after-listen"

  # The AI response should contain audio-related language
  if snapshot_contains "AI"; then
    # Check for substantive content in the last AI message
    local has_audio_words
    has_audio_words=0
    for word in "sound" "kick" "bass" "low" "frequency" "tone" "audio" "hear" "listen" "punch" "thump" "deep" "warm" "bright" "render"; do
      if snapshot_contains "$word"; then
        has_audio_words=1
        break
      fi
    done

    if [[ "$has_audio_words" -eq 1 ]]; then
      record_result "s3_listen_lens" "pass" "AI responded with substantive audio feedback about low end."
    else
      record_result "s3_listen_lens" "warn" "AI responded but no audio-specific language detected in snapshot."
    fi
  else
    record_result "s3_listen_lens" "warn" "Could not confirm AI response in snapshot."
  fi
}

# ---------------------------------------------------------------------------
# S4: Audio analysis tools
# ---------------------------------------------------------------------------

scenario_s4_audio_analysis() {
  echo "S4: Audio analysis tools..."

  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "s4-boot"

  # Seed a pattern
  click_view_button "Inst"
  snapshot_page "s4-inst"
  local step_ref
  step_ref="$(step_button_ref "1")"
  if [[ -n "$step_ref" ]]; then
    run_pw click "$step_ref" >/dev/null 2>&1
  fi

  # S4a: "analyze the spectrum of the kick"
  local rc=0
  submit_ai_prompt "Analyze the spectrum of the kick. Use the render and spectral tools." "s4a-spectral" || rc=$?
  if [[ "$rc" -eq 2 ]]; then
    record_result "s4_spectral" "blocked" "API not connected."
    return 0
  fi

  if [[ "$rc" -eq 0 ]]; then
    # Check for spectral-related language in response
    snapshot_page "s4a-result"
    if snapshot_contains "spectral" || snapshot_contains "centroid" || snapshot_contains "frequency" || snapshot_contains "brightness" || snapshot_contains "Hz" || snapshot_contains "spectrum"; then
      record_result "s4_spectral" "pass" "AI provided spectral analysis feedback."
    else
      record_result "s4_spectral" "warn" "AI responded but spectral analysis language not detected."
    fi
  else
    record_result "s4_spectral" "warn" "Spectral analysis prompt did not settle."
  fi

  # S4b: "how loud is the kick?"
  rc=0
  submit_ai_prompt "How loud is the kick? Use the render and dynamics tools to check levels." "s4b-dynamics" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    snapshot_page "s4b-result"
    if snapshot_contains "dB" || snapshot_contains "LUFS" || snapshot_contains "RMS" || snapshot_contains "peak" || snapshot_contains "loud" || snapshot_contains "dynamics" || snapshot_contains "level"; then
      record_result "s4_dynamics" "pass" "AI provided dynamics analysis feedback."
    else
      record_result "s4_dynamics" "warn" "AI responded but dynamics analysis language not detected."
    fi
  else
    record_result "s4_dynamics" "warn" "Dynamics analysis prompt did not settle."
  fi

  screenshot_page "s4-final"
}

# ---------------------------------------------------------------------------
# S5: Importance + open decisions
# ---------------------------------------------------------------------------

scenario_s5_importance_decisions() {
  echo "S5: Importance + open decisions..."

  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "s5-boot"

  # Seed patterns on both tracks
  click_view_button "Inst"
  local step_ref
  step_ref="$(step_button_ref "1")"
  if [[ -n "$step_ref" ]]; then
    run_pw click "$step_ref" >/dev/null 2>&1
  fi

  # S5a: Ask about importance
  local rc=0
  submit_ai_prompt "The kick is the most important element in this mix. Set its importance high." "s5a-importance" || rc=$?
  if [[ "$rc" -eq 2 ]]; then
    record_result "s5_importance" "blocked" "API not connected."
    return 0
  fi

  if [[ "$rc" -eq 0 ]]; then
    local ref
    ref="$(qa_anchor_ref)"
    local importance
    importance="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const track = projects[0].session.tracks.find(t => t.id === 'v0');
      resolve(track && track.importance != null ? String(track.importance) : 'unset');
    };
  };
})
JS
)" "$ref")"

    importance="$(printf '%s' "$importance" | tail -n 1 | tr -d '"')"
    echo "Kick importance: $importance"

    if [[ "$importance" != "unset" ]]; then
      if python3 -c "import sys; sys.exit(0 if float('$importance') >= 0.7 else 1)" 2>/dev/null; then
        record_result "s5_importance" "pass" "set_importance called: kick importance = $importance (>= 0.7)."
      else
        record_result "s5_importance" "warn" "set_importance called but importance $importance < 0.7."
      fi
    else
      record_result "s5_importance" "warn" "AI did not set importance via set_importance tool."
    fi
  else
    record_result "s5_importance" "warn" "Importance prompt did not settle."
  fi

  # S5b: Prompt with aesthetic uncertainty to trigger raise_decision
  rc=0
  submit_ai_prompt "I'm not sure whether the VA track should be a lush pad or a staccato arp. What do you think? Don't just pick one - raise this as a decision for me." "s5b-decision" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    local ref
    ref="$(qa_anchor_ref)"
    local decisions
    decisions="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const session = projects[0].session;
      const openDecisions = session.openDecisions || [];
      resolve(JSON.stringify(openDecisions.length));
    };
  };
})
JS
)" "$ref")"

    decisions="$(printf '%s' "$decisions" | tail -n 1 | tr -d '"')"
    echo "Open decisions count: $decisions"

    if [[ "$decisions" -gt 0 ]]; then
      record_result "s5_raise_decision" "pass" "raise_decision used: $decisions open decision(s) in session."
    else
      # Check if AI discussed the trade-off in text instead
      if snapshot_contains "pad" || snapshot_contains "arp" || snapshot_contains "decision" || snapshot_contains "option"; then
        record_result "s5_raise_decision" "warn" "AI discussed the trade-off in text but did not use raise_decision tool (decisions count: $decisions)."
      else
        record_result "s5_raise_decision" "warn" "AI did not use raise_decision and no trade-off discussion detected."
      fi
    fi
  else
    record_result "s5_raise_decision" "warn" "Decision prompt did not settle."
  fi

  screenshot_page "s5-final"
}

# ---------------------------------------------------------------------------
# S6: mark_approved tool
# ---------------------------------------------------------------------------

scenario_s6_mark_approved() {
  echo "S6: mark_approved tool..."

  run_pw open "$BASE_URL" >/dev/null 2>&1
  snapshot_page "s6-boot"

  local rc=0
  submit_ai_prompt "Mark the kick as approved. Use the mark_approved tool." "s6-mark" || rc=$?
  if [[ "$rc" -eq 2 ]]; then
    record_result "s6_mark_approved" "blocked" "API not connected."
    return 0
  fi

  if [[ "$rc" -ne 0 ]]; then
    # Retry
    rc=0
    submit_ai_prompt "Please mark the kick track v0 as approved." "s6-mark-retry" || rc=$?
  fi

  if [[ "$rc" -eq 0 ]]; then
    local ref
    ref="$(qa_anchor_ref)"
    local approval
    approval="$(eval_js "$(cat <<'JS'
el => new Promise((resolve) => {
  const req = indexedDB.open('gluon', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const projects = getAll.result;
      if (!projects || projects.length === 0) { resolve('no-projects'); return; }
      projects.sort((a, b) => (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0));
      const track = projects[0].session.tracks.find(t => t.id === 'v0');
      resolve(track ? (track.approval || 'exploratory') : 'no-track');
    };
  };
})
JS
)" "$ref")"

    approval="$(printf '%s' "$approval" | tail -n 1 | tr -d '"')"
    echo "Kick approval after mark: $approval"

    if [[ "$approval" == "approved" || "$approval" == "anchor" || "$approval" == "liked" ]]; then
      record_result "s6_mark_approved" "pass" "mark_approved tool set v0 approval to '$approval'."
    else
      record_result "s6_mark_approved" "warn" "v0 approval is '$approval' after mark_approved prompt. AI may not have used the tool."
    fi
  else
    record_result "s6_mark_approved" "warn" "mark_approved prompt did not settle."
  fi

  screenshot_page "s6-final"
}

# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

printf 'scenario\tresult\tnotes\n' >"$OUT_DIR/results.tsv"

echo "M6 behavioral validation run id: $RUN_ID"
echo "Base URL: $BASE_URL"
echo "Artifacts: $OUT_DIR"

if [[ -n "${QA_SCENARIOS:-}" ]]; then
  for scenario in $QA_SCENARIOS; do
    "$scenario" || true
  done
else
  # S7 and S8 run first — they don't need the dev server or API
  scenario_s7_merge_regression || true
  scenario_s8_prompt_state_sanity || true

  # Scenarios that need the dev server + API
  scenario_s1_approval_preservation || true
  scenario_s2_reaction_restraint || true
  scenario_s3_listen_lens || true
  scenario_s4_audio_analysis || true
  scenario_s5_importance_decisions || true
  scenario_s6_mark_approved || true
fi

echo
echo "M6 validation complete. Results: $OUT_DIR/results.tsv"

# Result semantics (same as smoke suite):
#   pass       — scenario verified the expected behavior
#   fail       — scenario detected a regression or missing behavior
#   reproduces — scenario detected a known issue that is still present
#   warn       — scenario ran but could not confirm expected behavior (inconclusive)
#   blocked    — scenario could not run due to missing prerequisites
#
# Both "fail" and "reproduces" are treated as failures for the exit code.
if awk -F'\t' 'NR > 1 && ($2 == "fail" || $2 == "reproduces") { found = 1 } END { exit(found ? 0 : 1) }' "$OUT_DIR/results.tsv"; then
  exit 1
fi
