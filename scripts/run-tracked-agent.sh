#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 7 ]; then
  echo "Usage: $0 <session> <agent> <model> <cwd> <branch> <task> <command...>"
  exit 1
fi

SESSION="$1"; shift
AGENT="$1"; shift
MODEL="$1"; shift
CWD_PATH="$1"; shift
BRANCH="$1"; shift
TASK="$1"; shift
CMD="$*"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR="$ROOT_DIR/active-contexts.json"
HISTORY="$ROOT_DIR/task-history.jsonl"

finalize() {
  local rc=$?
  local final_status="inactive"
  if [ "$rc" -ne 0 ]; then
    final_status="failed"
  fi

  local end_head=""
  local changed_files_json="[]"
  local diff_preview_json='""'
  if git -C "$CWD_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    end_head="$(git -C "$CWD_PATH" rev-parse HEAD 2>/dev/null || true)"
    # Collect changed files + compact diff preview (two JSON lines)
    local capture
    capture="$(python3 -c '
import json,sys,subprocess
cwd = sys.argv[1]
start = sys.argv[2]
end = sys.argv[3]
MAX_DIFF_LINES = 50
files = set()
diff_parts = []
# 1. Committed changes
if start and end and start != end:
    try:
        out = subprocess.check_output(["git","-C",cwd,"diff","--name-only",f"{start}..{end}"], text=True)
        files.update(f.strip() for f in out.splitlines() if f.strip())
    except Exception:
        pass
    try:
        out = subprocess.check_output(["git","-C",cwd,"diff",f"{start}..{end}"], text=True)
        if out.strip(): diff_parts.append(out)
    except Exception:
        pass
# 2. Staged changes
try:
    out = subprocess.check_output(["git","-C",cwd,"diff","--cached","--name-only"], text=True)
    files.update(f.strip() for f in out.splitlines() if f.strip())
except Exception:
    pass
try:
    out = subprocess.check_output(["git","-C",cwd,"diff","--cached"], text=True)
    if out.strip(): diff_parts.append(out)
except Exception:
    pass
# 3. Unstaged changes
try:
    out = subprocess.check_output(["git","-C",cwd,"diff","--name-only"], text=True)
    files.update(f.strip() for f in out.splitlines() if f.strip())
except Exception:
    pass
try:
    out = subprocess.check_output(["git","-C",cwd,"diff"], text=True)
    if out.strip(): diff_parts.append(out)
except Exception:
    pass
combined = "\n".join(diff_parts)
lines = combined.split("\n") if combined else []
if len(lines) > MAX_DIFF_LINES:
    preview = "\n".join(lines[:MAX_DIFF_LINES]) + "\n[... truncated, " + str(len(lines) - MAX_DIFF_LINES) + " more lines]"
else:
    preview = combined
print(json.dumps(sorted(files)))
print(json.dumps(preview))
' "$CWD_PATH" "$START_HEAD" "$end_head")"
    { read -r changed_files_json; read -r diff_preview_json; } <<< "$capture"
    changed_files_json="${changed_files_json:-[]}"
    diff_preview_json="${diff_preview_json:-\"\"}"
  fi

  upsert_context "$final_status"
  append_history "task_finished" "$final_status" "$START_HEAD" "$end_head" "$changed_files_json" "$diff_preview_json"
}
trap finalize EXIT

upsert_context() {
  local status="$1"
  python3 - "$SIDECAR" "$SESSION" "$AGENT" "$MODEL" "$CWD_PATH" "$BRANCH" "$TASK" "$status" <<'PY'
import json,sys,time,os
p,session,agent,model,cwd,branch,task,status = sys.argv[1:]
arr=[]
if os.path.exists(p):
    try:
        with open(p,'r',encoding='utf-8') as f:
            v=json.load(f)
            if isinstance(v,list): arr=v
    except Exception:
        arr=[]
entry={
  "session":session,
  "agent":agent,
  "model":model,
  "status":status,
  "cwd":cwd,
  "branch":branch,
  "task":task,
  "updatedAt":int(time.time()*1000)
}
replaced=False
for i,x in enumerate(arr):
    if isinstance(x,dict) and x.get('session')==session:
        arr[i]=entry
        replaced=True
        break
if not replaced:
    arr.append(entry)
with open(p,'w',encoding='utf-8') as f:
    json.dump(arr,f,indent=2)
    f.write('\n')
PY
}

append_history() {
  local event="$1"
  local status="$2"
  local startHead="${3:-}"
  local endHead="${4:-}"
  local changedFilesJson="${5:-[]}"
  local diffPreviewJson="${6:-\"\"}"
  python3 - "$HISTORY" "$SESSION" "$AGENT" "$MODEL" "$CWD_PATH" "$BRANCH" "$TASK" "$event" "$status" "$startHead" "$endHead" "$changedFilesJson" "$diffPreviewJson" <<'PY'
import json,sys,time
p,session,agent,model,cwd,branch,task,event,status,start_head,end_head,changed_files_json,diff_preview_json = sys.argv[1:]
try:
  changed_files = json.loads(changed_files_json)
  if not isinstance(changed_files, list):
    changed_files = []
except Exception:
  changed_files = []
entry={
  "ts": int(time.time()*1000),
  "event": event,
  "session": session,
  "agent": agent,
  "model": model,
  "cwd": cwd,
  "branch": branch,
  "task": task,
  "status": status,
}
if start_head:
  entry["startHead"] = start_head
if end_head:
  entry["endHead"] = end_head
entry["changedFiles"] = changed_files
try:
  diff_preview = json.loads(diff_preview_json)
  if isinstance(diff_preview, str) and diff_preview:
    entry["diffPreview"] = diff_preview
except Exception:
  pass
with open(p,'a',encoding='utf-8') as f:
  f.write(json.dumps(entry)+"\n")
PY
}

START_HEAD=""
if git -C "$CWD_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  START_HEAD="$(git -C "$CWD_PATH" rev-parse HEAD 2>/dev/null || true)"
fi

upsert_context "running"
append_history "task_started" "running" "$START_HEAD" "" "[]" '""'

cd "$CWD_PATH"
bash -lc "$CMD"
