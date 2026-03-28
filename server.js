const { WebSocketServer, WebSocket } = require("ws");
const { exec } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { announceTaskEvent, speakWithOpenAI } = require("./tts.js");

const PORT = 9876;
const POLL_INTERVAL = 2000; // ms
const RENDER_PATH = path.resolve(__dirname, "render.js");
const HISTORY_PATH = path.resolve(__dirname, "task-history.jsonl");
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

// Hot-reload render module on each call (edits take effect within 2s, no restart)
function render() {
  delete require.cache[RENDER_PATH];
  return require(RENDER_PATH).renderAllRepositories();
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
      ws.send(diff);
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
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(diff);
  }
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

function playAudioLocally(audioBuffer) {
  const tmpFile = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);
  fs.writeFileSync(tmpFile, audioBuffer);
  exec(`afplay "${tmpFile}" && rm "${tmpFile}"`, (err) => {
    if (err) console.error(`[TTS] Local playback error: ${err.message}`);
  });
}

function broadcastAudio(audioBuffer) {
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(audioBuffer);
  }
}

async function processNewHistoryEntries() {
  if (!fs.existsSync(HISTORY_PATH)) return;
  const content = fs.readFileSync(HISTORY_PATH, "utf8");
  const lines = content.split("\n").filter(Boolean);
  if (lines.length <= lastHistoryLineCount) return;

  const newLines = lines.slice(lastHistoryLineCount);
  lastHistoryLineCount = lines.length;

  for (const line of newLines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    console.log(`[TTS] Started TTS — event: ${entry.event}, task: "${entry.task}"`);
    try {
      const audio = await announceTaskEvent(entry, speakWithOpenAI);
      if (!audio) {
        console.log(`[TTS] Finished TTS — skipped (unknown event: ${entry.event})`);
        continue;
      }

      playAudioLocally(audio);
      broadcastAudio(audio);
      console.log(`[TTS] Finished TTS — success: ${audio.length} bytes, sent to ${wss.clients.size} client(s), playing locally`);
    } catch (err) {
      console.error(`[TTS] Finished TTS — error: ${err.message}`);
    }
  }
}

setInterval(async () => {
  try {
    await processNewHistoryEntries();
  } catch (err) {
    console.error(`[TTS] Watcher error: ${err.message}`);
  }
}, POLL_INTERVAL);
