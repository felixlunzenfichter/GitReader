# Native Sub-Agent Bridge (GitViewer)

This bridge makes native OpenClaw sub-agent runs visible in GitReader timeline + TTS by writing mapped events into `task-history.jsonl`.

## Default launcher

Use the wrapper so start events are never forgotten:

```bash
scripts/launch-native-subagent.sh \
  "agent:main:subagent:abc" \
  "run-123" \
  "opus-4.6" \
  "/Users/felixlunzenfichter/.openclaw/workspace" \
  "main" \
  "Research native subagents"
```

## Finish event

```bash
node scripts/native-subagent-bridge.js finish \
  --task "Research native subagents" \
  --session-key "agent:main:subagent:abc" \
  --run-id "run-123" \
  --status "inactive" \
  --result "wrote docs/native-subagents-display-properties-research.md" \
  --model "opus-4.6" \
  --runtime "subagent" \
  --mode "run" \
  --cwd "/Users/felixlunzenfichter/.openclaw/workspace" \
  --branch "main"
```

## Notes
- `render.js` shows `source`, `runtime`, `runId`, and `session_key` badges for timeline entries.
- TTS works automatically because events are normalized to `task_started` / `task_finished`.
- The wrapper exists to guarantee start-event visibility in UI/TTS for every native launch.
