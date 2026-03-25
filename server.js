const { WebSocketServer } = require("ws");
const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = 9876;
const POLL_INTERVAL = 2000; // ms
const WATCHED_REPO_FILE = path.join(require("os").homedir(), ".watched-repo");

// --- Read watched repo path ---
function getRepoPath() {
  try {
    return fs.readFileSync(WATCHED_REPO_FILE, "utf-8").trim();
  } catch {
    return null;
  }
}

// --- Get git diff from repo ---
function getGitDiff(repoPath) {
  try {
    // Staged + unstaged changes against HEAD
    let diff = execSync("git diff HEAD", {
      cwd: repoPath,
      maxBuffer: 1024 * 1024,
      timeout: 5000,
    }).toString();

    // If no uncommitted changes, show last commit's diff
    if (diff.trim().length === 0) {
      diff = execSync("git diff HEAD~1 HEAD", {
        cwd: repoPath,
        maxBuffer: 1024 * 1024,
        timeout: 5000,
      }).toString();
    }

    if (diff.trim().length === 0) {
      return `[No changes in ${path.basename(repoPath)}]`;
    }
    return diff;
  } catch (err) {
    return `[git diff error: ${err.message}]`;
  }
}

// --- Server ---
const wss = new WebSocketServer({ port: PORT });
let lastDiff = "";

console.log(`WebSocket server on ws://0.0.0.0:${PORT}`);
console.log(`Watching repo from: ${WATCHED_REPO_FILE}`);
console.log(`Poll interval: ${POLL_INTERVAL}ms`);
console.log("Waiting for connection...\n");

wss.on("connection", (ws, req) => {
  console.log(`Connected: ${req.socket.remoteAddress}`);

  ws.on("message", (msg) => {
    const text = msg.toString();
    console.log(`Received: ${text}`);
    if (text === "ready") {
      const repoPath = getRepoPath();
      if (!repoPath) {
        ws.send("[No ~/.watched-repo file found]");
        return;
      }
      console.log(`Repo: ${repoPath}`);
      const diff = getGitDiff(repoPath);
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

  const repoPath = getRepoPath();
  if (!repoPath) return;

  const diff = getGitDiff(repoPath);
  if (diff === lastDiff) return;

  lastDiff = diff;
  console.log(`Diff changed: ${diff.split("\n").length} lines — pushing to ${wss.clients.size} client(s)`);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(diff);
  }
}, POLL_INTERVAL);
