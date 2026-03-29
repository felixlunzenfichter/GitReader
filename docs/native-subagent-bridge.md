# Native OpenClaw Agent Events in GitReader

GitReader now reads native OpenClaw agent lifecycle directly from the local session store:

- primary source: `~/.openclaw/agents/main/sessions/sessions.json`
- transcript source: matching `*.jsonl` session files for task text + final summary
- rendered as normal `task_started` / `task_finished` timeline rows in GitViewer
- emitted live over WebSocket as explicit `task_event` envelopes so the iPad can log/react before the next full diff refresh

## Default path

No wrapper is required for normal native OpenClaw visibility anymore.

`render.js` synthesizes timeline entries directly from OpenClaw-native session lifecycle fields:

- `startedAt` -> `task_started`
- `updatedAt` + `status=done|failed` -> `task_finished`
- transcript `[Subagent Task]` text -> task title
- latest transcript text -> result summary

This is the new default path for native agent visibility on iPad.

## Compatibility fallback

The old JSONL bridge is still available as a compatibility layer when you need to inject synthetic events manually:

```bash
node scripts/native-subagent-bridge.js start \
  --task "Research native subagents" \
  --session-key "agent:main:subagent:abc" \
  --run-id "run-123"

node scripts/native-subagent-bridge.js finish \
  --task "Research native subagents" \
  --session-key "agent:main:subagent:abc" \
  --run-id "run-123" \
  --status "inactive" \
  --result "bridge path validated"
```

## Timeline evidence fields

GitReader shows these badges for both direct-native and compatibility events:

- `source`
- `runtime`
- `runId`
- `session_key`

Because native lifecycle is normalized into the same `task_started` / `task_finished` shape, the existing GitViewer timeline feed and downstream iPad/TTS surfaces continue to work without a rewrite.

## Live transport shape

The WebSocket server now sends two explicit message envelopes:

- `{ "type": "diff", "diff": "..." }`
- `{ "type": "task_event", "entry": { ...normalized native lifecycle row... } }`

`task_event` is emitted as soon as a fresh native lifecycle row is observed, so the iPad can:

- log native starts/finishes distinctly
- show a live overlay row immediately
- treat the event as TTS-eligible without waiting for the next snapshot diff refresh
