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

cleanup() {
  printf '[]\n' > "$SIDECAR"
}
trap cleanup EXIT

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

SESSION_JSON=$(json_escape "$SESSION")
AGENT_JSON=$(json_escape "$AGENT")
MODEL_JSON=$(json_escape "$MODEL")
CWD_JSON=$(json_escape "$CWD_PATH")
BRANCH_JSON=$(json_escape "$BRANCH")
TASK_JSON=$(json_escape "$TASK")

cat > "$SIDECAR" <<JSON
[
  {
    "session": ${SESSION_JSON},
    "agent": ${AGENT_JSON},
    "model": ${MODEL_JSON},
    "status": "running",
    "cwd": ${CWD_JSON},
    "branch": ${BRANCH_JSON},
    "task": ${TASK_JSON}
  }
]
JSON

cd "$CWD_PATH"
bash -lc "$CMD"
