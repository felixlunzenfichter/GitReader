const { WebSocketServer } = require("ws");
const path = require("path");

const PORT = 9876;
const POLL_INTERVAL = 2000; // ms
const RENDER_PATH = path.resolve(__dirname, "render.js");

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
    if (ws.readyState === 1) ws.send(diff);
  }
}, POLL_INTERVAL);
