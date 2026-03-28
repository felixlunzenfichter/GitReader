#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 6 ]; then
  echo "Usage: $0 <session> <agent> <model> <cwd> <branch> <command...>"
  exit 1
fi

SESSION="$1"; shift
AGENT="$1"; shift
MODEL="$1"; shift
CWD_PATH="$1"; shift
BRANCH="$1"; shift
CMD="$*"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR="$ROOT_DIR/active-contexts.json"

cleanup() {
  printf '[]\n' > "$SIDECAR"
}
trap cleanup EXIT

cat > "$SIDECAR" <<JSON
[
  {
    "session": "${SESSION}",
    "agent": "${AGENT}",
    "model": "${MODEL}",
    "status": "running",
    "cwd": "${CWD_PATH}",
    "branch": "${BRANCH}"
  }
]
JSON

cd "$CWD_PATH"
bash -lc "$CMD"
