# Claude Code Full Task Visibility — Research Notes

**Date:** 2026-03-28
**Goal:** Capture and display full Claude Code task inputs/prompts for worker transparency in a dashboard.

---

## 1. Exact Capture Points

### A. JSONL Transcript Files (Primary Source of Truth)

**Location:** `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`

The `<encoded-cwd>` replaces `/` with `-`. Example:
```
~/.claude/projects/-Users-felixlunzenfichter-Documents-GitReader/636fcac1-dfbe-4189-af77-d45f9b9d13fa.jsonl
```

**Entry types in each JSONL file:**

| Type | Purpose | Key Fields |
|------|---------|------------|
| `queue-operation` | Prompt enqueue/dequeue | `content` (full prompt text) |
| `user` | User messages + tool results | `message.content`, `sessionId`, `cwd`, `gitBranch`, `version`, `permissionMode` |
| `assistant` | Claude responses (text, thinking, tool_use) | `message.content[]`, `message.model`, `message.usage` (token counts incl. cache) |
| `system` | Metadata (turn durations) | `subtype: "turn_duration"`, `durationMs`, `messageCount` |
| `last-prompt` | Final prompt marker | `lastPrompt` |
| `file-history-snapshot` | File state snapshots | `snapshot` |

**Subagent transcripts:** `.../<session-id>/subagents/agent-<hash>.jsonl`
**Subagent metadata:** `.../<session-id>/subagents/agent-<hash>.meta.json` → `{"agentType":"general-purpose","description":"..."}`

### B. Global History (All Prompts Across All Projects)

**Location:** `~/.claude/history.jsonl`

Each line:
```json
{"display":"<prompt text>","pastedContents":{},"timestamp":<epoch_ms>,"project":"<path>"}
```

### C. Active Session Registry

**Location:** `~/.claude/sessions/<pid>.json`

```json
{
  "pid": 16993,
  "sessionId": "uuid",
  "cwd": "/path",
  "startedAt": 1769000000000,
  "kind": "interactive",
  "entrypoint": "sdk-cli"
}
```

### D. Sessions Index (Per Project)

**Location:** `~/.claude/projects/<encoded-cwd>/sessions-index.json`

```json
{
  "version": 1,
  "entries": [{
    "sessionId": "uuid",
    "fullPath": "/absolute/path/to/session.jsonl",
    "firstPrompt": "truncated prompt...",
    "summary": "human-readable summary",
    "messageCount": 2,
    "created": "ISO timestamp",
    "modified": "ISO timestamp",
    "gitBranch": "branch-name",
    "projectPath": "/path/to/project",
    "isSidechain": false
  }]
}
```

### E. Hooks (Real-Time Interception)

24 hook events available. Most relevant for task visibility:

| Hook | Blocks? | Captures |
|------|---------|----------|
| `UserPromptSubmit` | Yes | `prompt` — full user input text |
| `PreToolUse` | Yes | `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUse` | No | `tool_name`, `tool_input`, `tool_response` |
| `SubagentStart` | No | `agent_id`, `agent_type` |
| `SubagentStop` | Yes | `agent_id`, `agent_transcript_path`, `last_assistant_message` |
| `Stop` | Yes | `last_assistant_message` |
| `SessionStart` | No | `source`, `model`, `agent_type` |
| `SessionEnd` | No | `reason` |
| `TaskCreated` | Yes | `task_id`, `task_subject`, `task_description` |
| `TaskCompleted` | Yes | `task_id`, `task_subject`, `task_description` |

**Common fields on ALL hook payloads (BaseHookInput):**
```json
{
  "session_id": "string",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/working/dir",
  "permission_mode": "string",
  "hook_event_name": "string",
  "agent_id": "optional, subagent only",
  "agent_type": "optional"
}
```

**Hook output schema (stdout JSON):**
```json
{
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "injected context",
  "hookSpecificOutput": {}
}
```

**Hook configuration** in `settings.json`:
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{"type": "command", "command": "python3 /path/to/capture.py", "timeout": 10}]
    }]
  }
}
```

### F. CLI Structured Output (Non-Interactive Mode)

`claude --print --output-format json` returns:
```json
{
  "type": "result",
  "session_id": "uuid",
  "total_cost_usd": 0.07,
  "duration_ms": 2580,
  "duration_api_ms": 2571,
  "num_turns": 1,
  "result": "response text",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 2,
    "cache_creation_input_tokens": 10348,
    "cache_read_input_tokens": 11209,
    "output_tokens": 5
  },
  "modelUsage": {
    "claude-opus-4-6[1m]": {
      "inputTokens": 2,
      "outputTokens": 5,
      "costUSD": 0.07,
      "contextWindow": 1000000,
      "maxOutputTokens": 64000
    }
  }
}
```

`claude --print --output-format stream-json --verbose` yields real-time NDJSON events:
- `{"type":"system","subtype":"init","session_id":"...","model":"...","tools":[...]}`
- `{"type":"assistant","message":{...}}`
- `{"type":"result","subtype":"success",...}`

---

## 2. Recommended Data Model for Full Task Visibility

### Core Task Record

```typescript
interface AgentTask {
  // Identity
  task_id: string;                 // UUIDv7 (time-sortable)
  session_id: string;              // Groups tasks in one conversation
  parent_task_id: string | null;   // Sub-agent parent chain

  // Timing
  created_at: string;              // ISO 8601
  completed_at: string | null;
  duration_ms: number;

  // Status
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  exit_reason: string | null;

  // Prompt (3 tiers)
  prompt_summary: string;          // ≤200 chars, redacted, for dashboard
  prompt_redacted: string;         // Full text, secrets replaced
  prompt_original_hash: string;    // Content-addressable pointer to encrypted vault

  // Response
  response_summary: string;
  response_redacted: string;

  // Token usage
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost_usd: number;

  // Tool usage
  tool_calls: ToolCallRecord[];
  tools_used: string[];            // Deduplicated: ["Bash", "Edit", "Read"]

  // File impact
  files_read: string[];
  files_modified: string[];
  files_created: string[];

  // Git context
  git_branch: string;
  git_commit_before: string;
  git_commit_after: string | null;
  git_diff_stats: { insertions: number; deletions: number; files_changed: number } | null;

  // Agent metadata
  model_id: string;
  agent_type: "main" | "background" | "sub_agent";

  // Privacy
  redaction_count: number;
  redaction_rules_triggered: string[];
}

interface ToolCallRecord {
  tool: string;
  timestamp: string;
  duration_ms: number;
  command_redacted?: string;    // Bash only
  exit_code?: number;           // Bash only
  file_path?: string;           // Read/Edit only
  lines_changed?: number;       // Edit only
}

interface AgentSession {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  task_count: number;
  total_cost_usd: number;
  repo: string;
  branch: string;
}
```

### Storage: 3-Tier Architecture

| Tier | Content | Retention | Access |
|------|---------|-----------|--------|
| **1 — Dashboard** | `prompt_summary`, tools_used, files, cost, duration | Forever | Everyone |
| **2 — Audit** | `prompt_redacted`, `response_redacted`, full tool calls | 90 days | Team |
| **3 — Vault** | Original prompts, encrypted at rest (AES-256-GCM) | 30 days | Break-glass |

---

## 3. How to Avoid Truncation/Loss

### Problem
Claude Code sessions can have megabytes of prompt data (1M context window). Naive logging truncates.

### Solution: Content-Addressable Compressed Storage

```typescript
function storePrompt(text: string, baseDir: string): StoredContent {
  const hash = createHash("sha256").update(text).digest("hex");
  const compressed = gzipSync(Buffer.from(text, "utf-8"), { level: 9 });

  // Git-style fan-out directory (avoids single-dir explosion)
  const dir = `${baseDir}/${hash.slice(0, 2)}/${hash.slice(2, 4)}`;
  const path = `${dir}/${hash}.gz`;

  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, compressed);
  }

  return { hash, size_original: Buffer.byteLength(text), size_compressed: compressed.length, storage_path: path };
}
```

**Compression ratios:**
- English prose: 3:1 to 5:1
- Source code: 4:1 to 8:1
- System prompts (repeated): 10:1+

**Key trick:** System prompts like CLAUDE.md repeat on every task. Content-addressable = free dedup. Store once, reference by hash.

### Capture the JSONL directly

The JSONL file is already the full transcript. The simplest anti-truncation strategy: **copy the entire JSONL file** at session end via a `SessionEnd` or `Stop` hook:

```bash
# In a Stop hook:
cp "$TRANSCRIPT_PATH" /path/to/archive/$(date +%Y%m%d)-${SESSION_ID}.jsonl
```

---

## 4. Security Considerations

### Redaction Rules (Apply at Ingestion Boundary)

```typescript
const REDACTION_RULES = [
  { name: "aws_access_key",    pattern: /(?<![A-Z0-9])(AKIA[0-9A-Z]{16})(?![A-Z0-9])/g,           replacement: "[AWS_ACCESS_KEY]" },
  { name: "github_pat",        pattern: /ghp_[A-Za-z0-9]{36,}/g,                                   replacement: "[GITHUB_PAT]" },
  { name: "github_fine",       pattern: /github_pat_[A-Za-z0-9_]{82,}/g,                            replacement: "[GITHUB_FINE_PAT]" },
  { name: "jwt",               pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: "[JWT]" },
  { name: "bearer",            pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,                        replacement: "Bearer [REDACTED]" },
  { name: "stripe_key",        pattern: /(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{24,}/g,                replacement: "[STRIPE_KEY]" },
  { name: "slack_token",       pattern: /xox[baprs]-[A-Za-z0-9\-]{10,}/g,                          replacement: "[SLACK_TOKEN]" },
  { name: "connection_string", pattern: /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s"']+/gi,     replacement: "[REDACTED_CONN]" },
  { name: "private_key",       pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, replacement: "[REDACTED_KEY]" },
  { name: "env_value",         pattern: /(?<=(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|AUTH|CREDENTIAL)[A-Z_]*\s*=\s*)[^\s\n]+/gi, replacement: "[REDACTED]" },
  { name: "email",             pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,        replacement: "[EMAIL]" },
];
```

### File path allowlisting

```typescript
const SAFE_TO_LOG_CONTENT = ["src/**/*.ts", "src/**/*.swift", "tests/**", "*.md"];
const NEVER_LOG_CONTENT   = [".env*", "*.pem", "*.key", "*credentials*", "*secret*"];
```

### Principles

1. **Redact at ingestion, never downstream.** The moment text enters the logging pipeline, it must be redacted. No "we'll clean it up later."
2. **Log the shape, not the content.** Dashboard shows "47 words, touches auth.ts, references API key (redacted)" — not the raw prompt.
3. **Encrypted vault with access logging.** Original prompts stored only encrypted, with audit trail of who decrypted and why.
4. **Test redaction rules in CI** against a corpus of synthetic secrets. False negatives (leaked secrets) are catastrophic; false positives (over-redaction) are merely annoying.
5. **Retention decay.** Tier 3 (originals) → 30 days. Tier 2 (redacted) → 90 days. Tier 1 (summaries) → forever.

---

## 5. Practical Implementation: Hook-Based Capture Pipeline

### Minimal setup — capture every prompt + completion

**`settings.json`:**
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "python3 ~/.claude/hooks/log-prompt.py", "timeout": 5 }]
    }],
    "Stop": [{
      "hooks": [{ "type": "command", "command": "python3 ~/.claude/hooks/log-completion.py", "timeout": 10 }]
    }],
    "PostToolUse": [{
      "hooks": [{ "type": "command", "command": "python3 ~/.claude/hooks/log-tool.py", "timeout": 5 }]
    }]
  }
}
```

**`log-prompt.py` (sketch):**
```python
import json, sys, os, sqlite3
from datetime import datetime, timezone

payload = json.load(sys.stdin)
prompt = payload.get("prompt", "")
session_id = payload.get("session_id", "unknown")
transcript = payload.get("transcript_path", "")

db = sqlite3.connect(os.path.expanduser("~/.claude/task-log.db"))
db.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        timestamp TEXT,
        prompt_redacted TEXT,
        transcript_path TEXT,
        status TEXT DEFAULT 'running'
    )
""")
db.execute(
    "INSERT INTO tasks (session_id, timestamp, prompt_redacted, transcript_path) VALUES (?, ?, ?, ?)",
    (session_id, datetime.now(timezone.utc).isoformat(), redact(prompt), transcript)
)
db.commit()

# Must output valid JSON to stdout
print(json.dumps({"continue": True}))
```

### Full transcript archival — `Stop` hook

```python
import json, sys, shutil, os

payload = json.load(sys.stdin)
transcript = payload.get("transcript_path", "")
session_id = payload.get("session_id", "unknown")

if transcript and os.path.exists(transcript):
    archive_dir = os.path.expanduser("~/.claude/archive")
    os.makedirs(archive_dir, exist_ok=True)
    shutil.copy2(transcript, f"{archive_dir}/{session_id}.jsonl")

print(json.dumps({"continue": True}))
```

---

## 6. Top Actionable Recommendations

### 1. Use JSONL transcripts as primary data source
The `.jsonl` files at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` contain **everything**: full prompts, full responses, tool calls with inputs/outputs, token usage, model info, timing. Parse these directly rather than reconstructing from hooks.

### 2. Wire three hooks for real-time dashboard updates
`UserPromptSubmit` (task start), `PostToolUse` (progress), `Stop` (completion). Write to a local SQLite DB. This gives you live "what's running now" visibility with ~50 lines of Python.

### 3. Archive full JSONL transcripts on session end
A `Stop` hook that copies `$TRANSCRIPT_PATH` to an archive directory is the simplest way to guarantee zero truncation. The JSONL format is append-only and self-contained.

### 4. Redact at the ingestion boundary, never later
Apply regex-based redaction rules the moment any prompt or response enters your logging pipeline. Ship with rules for AWS keys, GitHub PATs, JWTs, Stripe keys, connection strings, private key blocks, and `.env` values. Test these in CI against synthetic secrets.

### 5. Use content-addressable storage for large prompts
SHA-256 hash + gzip compression + git-style fan-out directories. System prompts (CLAUDE.md etc.) repeat on every turn — content-addressable = automatic deduplication. A 500KB prompt compresses to ~100KB.

### 6. Build the dashboard on `sessions-index.json` + SQLite
`sessions-index.json` already gives you per-project session inventory with first prompt, summary, message count, timestamps, and git branch. Enrich with your SQLite hook data for cost, tool usage, and file impact. This avoids parsing every JSONL on each page load.
