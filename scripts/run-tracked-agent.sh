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
  upsert_context "$final_status"
  append_history "task_finished" "$final_status"
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
  python3 - "$HISTORY" "$SESSION" "$AGENT" "$MODEL" "$CWD_PATH" "$BRANCH" "$TASK" "$event" "$status" <<'PY'
import json,sys,time
p,session,agent,model,cwd,branch,task,event,status = sys.argv[1:]
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
with open(p,'a',encoding='utf-8') as f:
  f.write(json.dumps(entry)+"\n")
PY
}

upsert_context "running"
append_history "task_started" "running"

cd "$CWD_PATH"
bash -lc "$CMD"
