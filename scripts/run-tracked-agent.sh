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
  if git -C "$CWD_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    end_head="$(git -C "$CWD_PATH" rev-parse HEAD 2>/dev/null || true)"
    # Collect ALL changed files: committed + staged + unstaged
    changed_files_json="$(python3 -c '
import json,sys,subprocess
cwd = sys.argv[1]
start = sys.argv[2]
end = sys.argv[3]
files = set()
# 1. Committed changes (new commits since task start)
if start and end and start != end:
    try:
        out = subprocess.check_output(["git","-C",cwd,"diff","--name-only",f"{start}..{end}"], text=True)
        files.update(f.strip() for f in out.splitlines() if f.strip())
    except Exception:
        pass
# 2. Staged (index) changes
try:
    out = subprocess.check_output(["git","-C",cwd,"diff","--cached","--name-only"], text=True)
    files.update(f.strip() for f in out.splitlines() if f.strip())
except Exception:
    pass
# 3. Unstaged working-tree changes
try:
    out = subprocess.check_output(["git","-C",cwd,"diff","--name-only"], text=True)
    files.update(f.strip() for f in out.splitlines() if f.strip())
except Exception:
    pass
print(json.dumps(sorted(files)))
' "$CWD_PATH" "$START_HEAD" "$end_head")"
  fi

  upsert_context "$final_status"
  append_history "task_finished" "$final_status" "$START_HEAD" "$end_head" "$changed_files_json"
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
  python3 - "$HISTORY" "$SESSION" "$AGENT" "$MODEL" "$CWD_PATH" "$BRANCH" "$TASK" "$event" "$status" "$startHead" "$endHead" "$changedFilesJson" <<'PY'
import json,sys,time
p,session,agent,model,cwd,branch,task,event,status,start_head,end_head,changed_files_json = sys.argv[1:]
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
with open(p,'a',encoding='utf-8') as f:
  f.write(json.dumps(entry)+"\n")
PY
}

START_HEAD=""
if git -C "$CWD_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  START_HEAD="$(git -C "$CWD_PATH" rev-parse HEAD 2>/dev/null || true)"
fi

upsert_context "running"
append_history "task_started" "running" "$START_HEAD" "" "[]"

cd "$CWD_PATH"
bash -lc "$CMD"
