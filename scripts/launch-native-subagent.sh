#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 6 ]; then
  echo "Usage: $0 <session_key> <run_id> <model> <cwd> <branch> <task>"
  exit 1
fi

SESSION_KEY="$1"
RUN_ID="$2"
MODEL="$3"
CWD_PATH="$4"
BRANCH="$5"
TASK="$6"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE="$ROOT_DIR/scripts/native-subagent-bridge.js"

node "$BRIDGE" start \
  --task "$TASK" \
  --session-key "$SESSION_KEY" \
  --run-id "$RUN_ID" \
  --model "$MODEL" \
  --runtime "subagent" \
  --mode "run" \
  --cwd "$CWD_PATH" \
  --branch "$BRANCH"
