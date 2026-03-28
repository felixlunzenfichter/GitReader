# OpenClaw Task-Visibility Fields

**Date:** 2026-03-28

## Two core fields that control task visibility

### 1. `status`

- **Location:** `active-contexts.json` (per-context entry), `task-history.jsonl` (per-event)
- **Values:** `"running"` | `"inactive"` | `"failed"`
- **Role:** Determines how the task appears in the OpenClaw Task Timeline rendered by `render.js`. Running tasks are live; inactive/failed are historical.

### 2. `event`

- **Location:** `task-history.jsonl` (append-only log)
- **Values:** `"task_started"` | `"task_finished"`
- **Role:** Marks lifecycle transitions. The tracked-agent launcher (`scripts/run-tracked-agent.sh`) appends a `task_started` event on launch and a `task_finished` event on exit, enabling timeline reconstruction.

## Data flow

```
run-tracked-agent.sh
  |- upsert_context(status)   -> active-contexts.json
  |- append_history(event)    -> task-history.jsonl
                                      |
                                 render.js (polls)
                                      |
                                 server.js (WebSocket broadcast)
```
