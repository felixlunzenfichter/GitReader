const { WebSocketServer, WebSocket } = require("ws");
const { exec } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { announceTaskEvent, speakWithOpenAI } = require("./tts.js");
const { TTSQueue, stableEventKey, collapseBurst } = require("./tts-queue.js");
const { loadTaskHistory } = require("./render.js");

const PORT = Number(process.env.PORT || 9876);
const POLL_INTERVAL = 2000; // ms
const RENDER_PATH = path.resolve(__dirname, "render.js");
const HISTORY_PATH = process.env.GITREADER_HISTORY_PATH || path.resolve(__dirname, "task-history.jsonl");
const SECRETS_PATH = path.resolve(__dirname, ".secrets/openai.env");

function loadSecretsFromEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn("[TTS] No .secrets/openai.env — TTS disabled");
    return;
  }
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const m = line.match(/^(\w+)=["']?(.+?)["']?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
  console.log("[TTS] Loaded API key from .secrets/openai.env");
}

loadSecretsFromEnv(SECRETS_PATH);

function renderModule() {
  delete require.cache[RENDER_PATH];
  return require(RENDER_PATH);
}

// Hot-reload render module on each call (edits take effect within 2s, no restart)
function render() {
  return renderModule().renderAllRepositories();
}

function loadFreshTaskEvents(limit = 200) {
  return renderModule().loadTaskHistory(limit)
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function broadcastJson(payload) {
  const encoded = JSON.stringify(payload);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(encoded);
  }
}

// --- Server ---
const wss = new WebSocketServer({ port: PORT });
let lastDiff = "";

const { REPOSITORIES } = require(RENDER_PATH);
console.log(`WebSocket server on ws://0.0.0.0:${PORT}`);
console.log(`Poll interval: ${POLL_INTERVAL}ms`);
console.log("Configured repositories:");
for (const repo of REPOSITORIES) {
  console.log(`- ${repo.label}: ${repo.repoPath}`);
}
console.log("Waiting for connection...\n");

wss.on("connection", (ws, req) => {
  console.log(`Connected: ${req.socket.remoteAddress}`);

  ws.on("message", (msg) => {
    const text = msg.toString();
    console.log(`Received: ${text}`);
    if (text === "ready") {
      const diff = render();
      lastDiff = diff;
      console.log(`Sending initial diff: ${diff.split("\n").length} lines`);
      sendJson(ws, { type: "diff", diff });
    }
  });

  ws.on("close", () => console.log("Disconnected"));
  ws.on("error", (err) => console.error("Error:", err.message));
});

// --- Poll for changes and push updates ---
setInterval(() => {
  if (wss.clients.size === 0) return;

  const diff = render();
  if (diff === lastDiff) return;

  lastDiff = diff;
  console.log(`Diff changed: ${diff.split("\n").length} lines — pushing to ${wss.clients.size} client(s)`);
  broadcastJson({ type: "diff", diff });
}, POLL_INTERVAL);

// --- TTS watcher: announce task lifecycle events ---
let lastHistoryLineCount = 0;
try {
  const content = fs.readFileSync(HISTORY_PATH, "utf8");
  lastHistoryLineCount = content.split("\n").filter(Boolean).length;
  console.log(`[TTS] Watching task-history.jsonl (${lastHistoryLineCount} existing entries)`);
} catch {
  console.log("[TTS] No task-history.jsonl yet — will watch for creation");
}

function playAudioLocally(audioBuffer, entry) {
  const tmpFile = path.join(os.tmpdir(), `tts-${Date.now()}-${process.pid}.mp3`);
  fs.writeFileSync(tmpFile, audioBuffer);

  return new Promise((resolve) => {
    console.log(`[TTS] Local playback queued — event: ${entry.event}, task: "${entry.task}"`);
    exec(`afplay "${tmpFile}"`, (err) => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}

      if (err) {
        console.error(`[TTS] Local playback error: ${err.message}`);
      } else {
        console.log(`[TTS] Local playback finished — event: ${entry.event}, task: "${entry.task}"`);
      }
      resolve();
    });
  });
}

function broadcastAudio(audioBuffer, entry) {
  console.log(`[TTS] Broadcasting audio — event: ${entry.event}, task: "${entry.task}", clients: ${wss.clients.size}`);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(audioBuffer);
  }
}

const ttsQueue = new TTSQueue({
  shortTaskThresholdMs: 2500,
  onSkip({ reason, entry }) {
    if (reason === "duplicate") {
      console.log(`[TTS] Skipped duplicate event — key: ${stableEventKey(entry)}`);
      return;
    }
    if (reason === "collapsed_short_task") {
      console.log(`[TTS] Collapsed short task burst — skipped start/finish spam for: ${entry.task}`);
    }
  },
  async speakEvent(entry) {
    await maybeSpeakTaskEvent(entry);
  },
});

function seedSeenTTSEventsFromCurrentHistory() {
  const existingEntries = loadTaskHistory(200);
  ttsQueue.seed(existingEntries);
  console.log(`[TTS] Seeded ${existingEntries.length} historical event(s); only fresh events after launch will be spoken`);
}

seedSeenTTSEventsFromCurrentHistory();

async function maybeSpeakTaskEvent(entry) {
  console.log(`[TTS] Started TTS — event: ${entry.event}, task: "${entry.task}"`);
  try {
    const audio = await announceTaskEvent(entry, speakWithOpenAI);
    if (!audio) {
      console.log(`[TTS] Finished TTS — skipped (unknown event: ${entry.event})`);
      return;
    }

    broadcastAudio(audio, entry);
    await playAudioLocally(audio, entry);
    console.log(`[TTS] Finished TTS — success: ${audio.length} bytes, sent to ${wss.clients.size} client(s), playback drained`);
  } catch (err) {
    console.error(`[TTS] Finished TTS — error: ${err.message}`);
  }
}

async function processNewHistoryEntries() {
  const entries = loadTaskHistory(200)
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

  for (const entry of entries) {
    const key = eventTTSKey(entry);
    if (seenTTSEvents.has(key)) continue;
    seenTTSEvents.add(key);

    console.log(`[LIVE] Native task event: ${entry.event} :: ${entry.task} :: ${entry.session_key || entry.session || "-"}`);
    broadcastJson({ type: "task_event", entry });
    await maybeSpeakTaskEvent(entry);
  }

  if (!fs.existsSync(HISTORY_PATH)) return;
  const content = fs.readFileSync(HISTORY_PATH, "utf8");
  const lines = content.split("\n").filter(Boolean);
  lastHistoryLineCount = lines.length;
}

setInterval(async () => {
  try {
    await processNewHistoryEntries();
  } catch (err) {
    console.error(`[TTS] Watcher error: ${err.message}`);
  }
}, POLL_INTERVAL);
