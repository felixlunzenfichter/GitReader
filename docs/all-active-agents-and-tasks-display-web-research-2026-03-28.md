# All Active Agents and Tasks Display: Web Research

**Date:** 2026-03-28
**Context:** Designing a SwiftUI iPad app that displays a grid of all active Claude Code agents with their full task prompts visible. Research covers display patterns, state management, color coding, real-time updates, and practical implementation.

---

## Top 8 Recommendations

1. **Use a Kanban-style column layout with 3 columns: Running (yellow), Waiting (orange), Completed (grey).** Borrowed from the Claude Code Agent Monitor project, which uses a 5-column Kanban board (connected, working, idle, completed, error). For a focused iPad dashboard, 3 columns suffice. Each card shows agent ID, task prompt (first 2 lines), elapsed time, and a pulsing status dot.

2. **Show full task prompts via SwiftUI `DisclosureGroup` with a 2-line preview + expand pattern.** Default: show first 2 lines of the prompt with monospaced font, truncated with ellipsis. Tap to expand the full prompt in-place using `DisclosureGroup`. Long-press for a full-screen modal with copy-to-clipboard. This matches the VS Code pattern where you can "expand any subagent to see the full prompt and result."

3. **Use the Astro status color scale for state indicators: Running = `#FCE83A` (Caution/Yellow), Waiting = `#FFB302` (Serious/Orange), Normal = `#56F000` (Green), Off = `#A4ABB6` (Grey).** Combine each color with a distinct shape (circle for running, triangle for waiting, checkmark for complete) to support color-blind users. This is the industry-standard pattern from aerospace/mission-control dashboards (Astro UXDS).

4. **Consume Claude Code agent state via HTTP hooks posting to a local Bun/Express server, then push to SwiftUI via WebSocket.** Configure Claude Code hooks (SubagentStart, SubagentStop, Stop, SessionStart, SessionEnd, TaskCreated, TaskCompleted) with `"type": "http"` to POST JSON events to `http://localhost:4000/hooks`. The server stores state in SQLite and broadcasts via WebSocket. SwiftUI connects via `URLSessionWebSocketTask`. This is the exact architecture used by both the Claude Code Agent Monitor and the multi-agent observability projects.

5. **Add a pulsing animation to the status indicator for actively-running agents.** Both htop (green for running processes) and Grafana (animated spinners for in-progress) use motion to distinguish "actively computing" from "idle/waiting." In SwiftUI, use a `withAnimation(.easeInOut(duration: 1).repeatForever())` on opacity for the status dot of running agents.

6. **Display elapsed time as a live-updating counter (e.g., "2m 34s") on each agent card.** The Claude Code Agent Monitor tracks session duration. For a dashboard, showing elapsed time since task start gives immediate "is this stuck?" feedback without needing to read logs. Use SwiftUI `TimelineView(.periodic(from: .now, by: 1.0))` for efficient per-second updates.

7. **Use a dual-border color system to distinguish agent identity from agent state.** From the multi-agent observability project: left border = application/session color (consistent per agent), secondary indicator = state color. This lets you track "which agent is which" even when states change. Assign each agent a stable color from a 6-color palette on creation.

8. **Implement a consolidated "worst status" indicator at the top of the dashboard.** From the Astro UXDS pattern and Datadog status pages: when showing aggregate status, always surface the highest-severity state. If any agent is in error state, the header shows red. If any is waiting, show orange. Only show green when all are complete or running normally.

---

## 1. List/Table Design for Multiple Concurrent Agents

### Best Pattern: Kanban Board with Agent Cards

The Claude Code Agent Monitor (github.com/hoangsonww/Claude-Code-Agent-Monitor) provides the most directly relevant reference. It displays agents across a 5-column Kanban board organized by state:

| Column | State | Meaning |
|--------|-------|---------|
| Connected | Initial | Agent just spawned |
| Working | Active | Processing a tool call |
| Idle | Paused | Turn completed, waiting |
| Completed | Done | Session ended normally |
| Error | Failed | Error state |

Each column supports pagination. Agent cards show:
- Agent ID and session relationship
- Parent-child hierarchy (collapsible tree for subagents)
- Recent activity with timestamps
- Token usage and cost estimation

**VS Code Agent Sessions View** (Feb 2026) takes a different approach: a single list with type indicators (local/background/cloud). Key design decisions:
- Compact view shows 3 most recent sessions when panel is narrow
- Side-by-side view auto-activates when panel is wide enough
- Each session shows: agent type, task description, status
- Expandable subagents show "full prompt and result"

**OpenHands** uses a React SPA where each agent session gets a dedicated panel showing: file tree, terminal output, browser activity, and chat. For multiple concurrent tasks, they use agent delegation with parallel sub-agents that block until all complete.

### Why It Works
Kanban columns map directly to the agent lifecycle state machine. Users can scan left-to-right to see progress flow. Card-based layouts work well on iPad where touch targets need to be large.

### Implementation Notes
- For iPad, use a `LazyVGrid` with adaptive columns (`GridItem(.adaptive(minimum: 300))`)
- Group by state, not by agent type
- Show newest agents at the top of each column
- Use `ScrollView(.horizontal)` if columns overflow on narrower iPad orientations

---

## 2. Full Prompt Display Strategy

### Best Pattern: 2-Line Preview + DisclosureGroup + Full-Screen Modal

Three tiers of prompt visibility, matching patterns from VS Code panels and Jupyter notebooks:

**Tier 1 - Preview (default):** Show first 2 lines of the prompt in monospaced font, truncated with `lineLimit(2)` and `.truncationMode(.tail)`. This gives enough context to identify the task ("Fix the auth bug in login.swift...") without consuming card space.

**Tier 2 - Inline Expand:** SwiftUI `DisclosureGroup` with chevron toggle. Expands the card in-place to show the full prompt. The VS Code blog confirms this pattern: "expand any subagent to see the full prompt and result." Use `withAnimation(.spring())` for smooth expansion.

**Tier 3 - Full-Screen Modal:** Long-press gesture opens a `.sheet` or `.fullScreenCover` with:
- Full prompt text in a `ScrollView`
- Copy-to-clipboard button (using `UIPasteboard.general`)
- Syntax highlighting if the prompt contains code blocks
- Dismiss via swipe-down

**Additional patterns from Jupyter notebooks:**
- Cell-style display: each prompt is a "cell" with a header (agent ID, timestamp) and body (prompt text)
- Output appears below the prompt cell when available
- Collapsible output sections for long results

### Why It Works
Progressive disclosure respects the information hierarchy: most of the time you just need to know *which* task is running (2 lines). When you need detail, expand in-place. When you need to study or copy, go full-screen.

### Implementation Notes
```swift
// Tier 1 + 2 combined
DisclosureGroup(isExpanded: $isExpanded) {
    Text(agent.fullPrompt)
        .font(.system(.caption, design: .monospaced))
        .textSelection(.enabled)
} label: {
    Text(agent.fullPrompt)
        .lineLimit(2)
        .font(.system(.caption, design: .monospaced))
        .truncationMode(.tail)
}
```
- Use `.textSelection(.enabled)` so users can select and copy portions
- Store expansion state per-agent in a `Set<AgentID>`
- For the modal, use `@State private var selectedAgent: Agent?` with `.sheet(item:)`

---

## 3. Active/Inactive State Styling

### Best Pattern: Astro UXDS 6-Level Status System with Shape+Color

The Astro UX Design System (astrouxds.com), developed for aerospace mission control, defines the industry-standard status color scale based on color temperature:

| Level | Color | Hex | Shape | Use For |
|-------|-------|-----|-------|---------|
| Off | Grey | `#A4ABB6` | Empty circle | Disabled, unavailable |
| Standby | Cyan | `#2DCCFF` | Diamond | Available, ready |
| Normal | Green | `#56F000` | Filled circle | Running OK, complete |
| Caution | Yellow | `#FCE83A` | Filled circle + pulse | Active, in-progress |
| Serious | Orange | `#FFB302` | Triangle | Needs attention, waiting |
| Critical | Red | `#FF3838` | Filled square | Error, emergency |

**Key design rules:**
- Always pair color with a distinct shape for color-blind accessibility
- Reserve red exclusively for urgent/error states (prevents desensitization)
- When consolidating multiple statuses, show the highest severity level
- On light backgrounds, add darker borders for WCAG AA contrast

**Reference patterns from other tools:**

| Tool | Active | In-Progress | Idle/Waiting | Complete | Error |
|------|--------|-------------|--------------|----------|-------|
| GitHub Actions | - | Yellow spinner | Grey | Green check | Red X |
| Grafana | - | Yellow | - | Green | Red |
| Datadog | Green (Operational) | - | Yellow (Degraded) | Green | Red (Outage) |
| htop | Green (Running) | - | Grey (Sleeping) | - | Red (Zombie) |
| Carbon Design | Blue (Active) | Yellow (In-progress) | Grey (Inactive) | Green (Success) | Red (Error) |

**For the agent dashboard specifically:**
- Running agent = Yellow (`#FCE83A`) filled circle with pulse animation
- Waiting for input = Orange (`#FFB302`) triangle (draws attention)
- Completed = Green (`#56F000`) checkmark
- Error = Red (`#FF3838`) filled square
- Queued/not started = Grey (`#A4ABB6`) empty circle

### Why It Works
Color temperature maps to urgency intuitively (cool=safe, hot=urgent). Shape redundancy ensures accessibility. The 5-state model covers all agent lifecycle states without overwhelming the visual system. Grafana and Datadog recommend limiting to 3-5 distinct states for at-a-glance comprehension.

### Implementation Notes
```swift
enum AgentStatus {
    case queued, running, waiting, completed, error

    var color: Color {
        switch self {
        case .queued:    return Color(hex: "#A4ABB6")
        case .running:   return Color(hex: "#FCE83A")
        case .waiting:   return Color(hex: "#FFB302")
        case .completed: return Color(hex: "#56F000")
        case .error:     return Color(hex: "#FF3838")
        }
    }

    var systemImage: String {
        switch self {
        case .queued:    return "circle"
        case .running:   return "circle.fill"
        case .waiting:   return "exclamationmark.triangle.fill"
        case .completed: return "checkmark.circle.fill"
        case .error:     return "xmark.square.fill"
        }
    }
}
```

---

## 4. Update Cadence / Event Model

### Best Pattern: HTTP Hooks to Local Server + WebSocket Push to SwiftUI

The consensus across all sources is clear: **use WebSocket for real-time agent dashboards, fall back to SSE for simpler one-way feeds.**

**Protocol comparison for this use case:**

| Method | Latency | Complexity | Best For |
|--------|---------|------------|----------|
| Polling | 1-5s | Low | Simple status checks |
| SSE | ~0ms (one-way) | Medium | Server-to-client feeds, logs |
| WebSocket | ~0ms (bidirectional) | Higher | Interactive dashboards, send commands back |

**The Claude Code Agent Monitor achieves "~0ms latency, no polling"** using WebSocket. Its architecture:

```
Claude Code Hooks (JSON stdin)
    |
    v
Hook Script (shell/python) -- HTTP POST -->
    |
    v
Local Server (Bun/Express, port 4000)
    |
    +--> SQLite (persistent state)
    |
    +--> WebSocket broadcast to all clients
            |
            v
        Dashboard (React / SwiftUI)
```

**The multi-agent observability project** uses the same pattern:
```
Claude Agents --> Hook Scripts --> HTTP POST --> Bun Server --> SQLite --> WebSocket --> Vue Client
```

**Claude Code hook types that matter for agent monitoring:**

| Hook Event | What It Tells You |
|------------|-------------------|
| `SessionStart` | New agent session began |
| `SubagentStart` | Subagent spawned (with agent type) |
| `SubagentStop` | Subagent finished |
| `TaskCreated` | Task created via TaskCreate |
| `TaskCompleted` | Task marked complete |
| `PreToolUse` | Agent is about to use a tool (transition to "working") |
| `Stop` | Agent finished responding (transition to "idle") |
| `Notification` | Agent waiting for input |
| `SessionEnd` | Session terminated |

**For a local dev tool, SSE is simpler and sufficient** if you only need to display status (no commands back). Mission Control (builderz.dev) uses "WebSocket + SSE push updates with smart polling that pauses when you're away" — a hybrid approach.

### Why It Works
Hook events are inherently push-based (Claude Code fires them). HTTP hooks (`"type": "http"`) eliminate the need for shell scripts as intermediaries. WebSocket gives the SwiftUI client instant updates without polling overhead. SQLite provides crash-resilient state that survives dashboard restarts.

### Implementation Notes
- Configure hooks with `"type": "http"` in `~/.claude/settings.json` — no shell scripts needed
- Hook scripts "fail silently with a 5s timeout so they never block Claude Code"
- Use SQLite with WAL mode for concurrent read/write access
- SwiftUI: use `URLSessionWebSocketTask` or a lightweight library like `Starscream`
- Debounce UI updates: batch WebSocket messages that arrive within 100ms into a single view update
- Smart reconnection: if WebSocket drops, reconnect with exponential backoff

---

## 5. Practical Implementation for Local Claude Code / Tracked-Agent Setup

### Best Pattern: HTTP Hook + Bun Server + SQLite + WebSocket + SwiftUI

This section provides a concrete architecture for building the dashboard.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 CLAUDE CODE INSTANCES                        │
│                                                             │
│  Agent 1 (main)     Agent 2 (background)   Agent 3 (sub)   │
│      │                    │                      │          │
│      └────────────────────┼──────────────────────┘          │
│                           │                                 │
│                    Hook Events (JSON)                        │
│                           │                                 │
│                    "type": "http"                            │
│                    POST to localhost:4000                    │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              AGENT STATE SERVER (Bun/Node)                   │
│                     Port 4000                                │
│                                                             │
│  POST /hooks/event  ──→  Process event                      │
│                          Update SQLite                      │
│                          Broadcast via WebSocket             │
│                                                             │
│  GET /agents        ──→  Return all agent states (REST)     │
│  WS  /ws            ──→  Real-time event stream             │
│                                                             │
│  SQLite (WAL mode):                                         │
│    agents: id, session_id, parent_id, status, prompt,       │
│            started_at, last_event_at                         │
│    events: id, agent_id, event_type, payload, timestamp     │
└───────────────────────────┼─────────────────────────────────┘
                            │
                   WebSocket + REST
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              SWIFTUI iPAD DASHBOARD                          │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ Agent 1 │  │ Agent 2 │  │ Agent 3 │  │ Agent 4 │       │
│  │ ● Run   │  │ ▲ Wait  │  │ ✓ Done  │  │ ● Run   │       │
│  │ "Fix bug│  │ "Review │  │ "Add te│  │ "Refact│       │
│  │  in..."  │  │  PR..." │  │  sts..." │  │  or..." │       │
│  │ 2m 34s  │  │ 5m 12s  │  │ 1m 08s  │  │ 0m 45s  │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
│                                                             │
│  [Consolidated Status Bar: 2 Running, 1 Waiting, 1 Done]   │
└─────────────────────────────────────────────────────────────┘
```

### Claude Code Hook Configuration

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/hooks/event"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/hooks/event"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/hooks/event"
          }
        ]
      }
    ],
    "TaskCreated": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/hooks/event"
          }
        ]
      }
    ],
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/hooks/event"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/hooks/event"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/hooks/event"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/hooks/event"
          }
        ]
      }
    ]
  }
}
```

### Agent State Machine

```
SessionStart ──→ CONNECTED
PreToolUse   ──→ WORKING
Stop         ──→ IDLE
Notification ──→ WAITING (needs input)
SessionEnd   ──→ COMPLETED
Error        ──→ ERROR

SubagentStart ──→ create child agent in CONNECTED
SubagentStop  ──→ transition child to COMPLETED
TaskCreated   ──→ attach task prompt to agent
TaskCompleted ──→ mark task done
```

### SwiftUI Data Model

```swift
@Observable
class AgentDashboard {
    var agents: [Agent] = []
    private var webSocketTask: URLSessionWebSocketTask?

    struct Agent: Identifiable {
        let id: String          // session_id
        var parentId: String?   // for subagent hierarchy
        var status: AgentStatus
        var prompt: String      // the task prompt
        var startedAt: Date
        var lastEventAt: Date
        var toolsUsed: Int
        var identityColor: Color // stable color per agent
    }

    func connect() {
        let url = URL(string: "ws://localhost:4000/ws")!
        webSocketTask = URLSession.shared.webSocketTask(with: url)
        webSocketTask?.resume()
        receiveMessage()
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                // Parse JSON, update agents array
                // SwiftUI observes changes automatically
                self?.receiveMessage() // continue listening
            case .failure:
                // Reconnect with backoff
                break
            }
        }
    }
}
```

### Alternative: File-System Watcher (No Server)

For a simpler setup without a server, Claude Code hooks can write to JSON files that SwiftUI watches:

```swift
// Use DispatchSource to watch a directory
let descriptor = open("/tmp/claude-agents/", O_EVTONLY)
let source = DispatchSource.makeFileSystemObjectSource(
    fileDescriptor: descriptor,
    eventMask: .write,
    queue: .main
)
source.setEventHandler {
    // Re-read JSON files from /tmp/claude-agents/
    // Update dashboard state
}
source.resume()
```

Hook writes agent state to `/tmp/claude-agents/{session_id}.json` on each event. Simpler but higher latency (~100-500ms for file I/O vs ~0ms for WebSocket).

### iPad Layout Considerations

- Use `LazyVGrid(columns: [GridItem(.adaptive(minimum: 280))])` for responsive card grid
- On iPad Pro 12.9" landscape: fits 4 cards per row comfortably
- On iPad Mini: 2 cards per row
- Use `.navigationSplitView` for optional detail panel on the right
- Cards should be at minimum 280pt wide, 150pt tall (collapsed prompt)
- Expanded cards grow vertically; use `ScrollView` to handle overflow

---

## References

### Claude Code Agent Monitoring
- [Claude Code Agent Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) - Real-time monitoring dashboard with Kanban board, WebSocket, SQLite. Most comprehensive reference implementation.
- [Claude Code Hooks Multi-Agent Observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) - Hook-based event tracking with Vue dashboard, dual-color border system.
- [AI Coding Agent Dashboard: Orchestrating Claude Code Across Devices](https://blog.marcnuri.com/ai-coding-agent-dashboard) - Cross-device agent orchestration concept.
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide) - Official documentation for all 23 hook event types, HTTP hooks, and JSON schemas.
- [Claude Code Async: Background Agents & Parallel Tasks](https://claudefa.st/blog/guide/agents/async-workflows) - Background agent patterns.

### VS Code Multi-Agent
- [Your Home for Multi-Agent Development](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development) - VS Code 1.109 Agent Sessions view, session type picker, background/local/cloud agent categories.
- [VS Code Multi-Agent Orchestration (Visual Studio Magazine)](https://visualstudiomagazine.com/articles/2026/02/09/hands-on-with-new-multi-agent-orchestration-in-vs-code.aspx) - Hands-on details.
- [VS Code Subagents Documentation](https://code.visualstudio.com/docs/copilot/agents/subagents) - Expandable subagent hierarchy patterns.

### Status Indicator Design Systems
- [Astro UX Design System - Status System](https://www.astrouxds.com/patterns/status-system/) - 6-level color temperature scale with shapes. Industry standard for mission-critical dashboards.
- [Carbon Design System - Status Indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/) - IBM's status indicator pattern with size variants and density options.
- [Mobbin - Status Dot UI Design](https://mobbin.com/glossary/status-dot) - Real-world status dot examples from production apps.

### Real-Time Communication
- [WebSockets vs SSE vs Polling (DEV Community)](https://dev.to/crit3cal/websockets-vs-server-sent-events-vs-polling-a-full-stack-developers-guide-to-real-time-3312) - Comprehensive protocol comparison.
- [Mission Control - Open-Source AI Agent Orchestration Dashboard](https://mc.builderz.dev) - Uses WebSocket + SSE + smart polling hybrid.
- [SSE vs WebSockets (OneUptime)](https://oneuptime.com/blog/post/2026-01-27-sse-vs-websockets/view) - Protocol selection guide.

### Agent UI Design
- [UI Design for AI Agents (Fuselab Creative)](https://fuselabcreative.com/ui-design-for-ai-agents/) - Conversational UI patterns, proactive nudges, transparency features.
- [Designing User Interfaces for Agentic AI (Codewave)](https://codewave.com/insights/designing-agentic-ai-ui/) - Goal-setting, monitoring, and intervention patterns.
- [Agent-Native Development: Devin 2.0 Technical Design](https://medium.com/@takafumi.endo/agent-native-development-a-deep-dive-into-devin-2-0s-technical-design-3451587d23c0) - Devin's replay timeline and real-time monitoring approach.

### Process Monitoring Patterns
- [htop Color Interpretation (Baeldung)](https://www.baeldung.com/linux/htop-color-interpretation) - Green=running, grey=sleeping, red=kernel.
- [btop GitHub](https://github.com/aristocratos/btop) - Color-coded process list with gradient.
- [Grafana Status History](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/status-history/) - Green/yellow/red status mapping, limit to 3-5 states.
- [Datadog Status Pages](https://docs.datadoghq.com/incident_response/status_pages/) - Operational/Degraded/Partial Outage/Major Outage hierarchy.

### AI Agent Observability
- [15 AI Agent Observability Tools in 2026](https://research.aimultiple.com/agentic-monitoring/) - Landscape overview including Langfuse, Arize.
- [Top 5 AI Agent Monitoring Platforms in 2026](https://www.getmaxim.ai/articles/top-5-ai-agent-monitoring-platforms-in-2026/) - Platform comparison.
- [OpenHands Sub-Agent Delegation](https://docs.openhands.dev/sdk/guides/agent-delegation) - Parallel sub-agent execution model.

### SwiftUI File Watching
- [DispatchSource: Detecting Changes in Files and Folders (SwiftRocks)](https://swiftrocks.com/dispatchsource-detecting-changes-in-files-and-folders-in-swift) - Core pattern for file-based agent state monitoring.
- [FileMonitor Swift Package](https://swiftpackageindex.com/aus-der-Technik/FileMonitor) - AsyncStream-based file monitoring.
- [Apple FSEvents Documentation](https://developer.apple.com/documentation/coreservices/file_system_events) - Low-level directory monitoring API.

### SwiftUI Patterns
- [DisclosureGroup Explorations (Holy Swift)](https://holyswift.app/accordion-in-swiftui-disclosuregroup-explorations/) - Accordion/expand-collapse patterns.
- [Working with DisclosureGroup (Chris Wu)](https://chriswu.com/posts/swiftui/disclosure1/) - State management for multiple disclosure groups.
- [GitHub Actions Workflow Status](https://docs.github.com/actions/managing-workflow-runs/adding-a-workflow-status-badge) - Status badge display conventions.
