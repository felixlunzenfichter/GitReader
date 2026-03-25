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

// --- Git helpers ---
function gitExec(cmd, repoPath) {
  return execSync(cmd, { cwd: repoPath, maxBuffer: 1024 * 1024, timeout: 5000 }).toString().trim();
}

function getGitDiff(repoPath) {
  try {
    const branch = gitExec("git rev-parse --abbrev-ref HEAD", repoPath);
    const repoName = path.basename(repoPath);

    // Always: current branch versus main
    const diff = gitExec("git diff main...HEAD", repoPath);

    if (diff.length === 0) {
      return `[No diff: ${branch} is identical to main]`;
    }

    // List local branches
    const localBranches = gitExec("git branch --format='%(refname:short)'", repoPath)
      .split("\n")
      .filter((b) => b);

    // List remote branches (strip "origin/" prefix, exclude HEAD)
    const remoteBranches = gitExec("git branch -r --format='%(refname:short)'", repoPath)
      .split("\n")
      .map((b) => b.replace("origin/", ""))
      .filter((b) => b && b !== "HEAD" && b !== "origin");

    // List open PRs via gh CLI
    let prLines = [];
    try {
      const prJson = gitExec("/usr/local/bin/gh pr list --state open --json number,title,headRefName --limit 20", repoPath);
      const prs = JSON.parse(prJson);
      if (prs.length > 0) {
        prLines = [
          `# OPEN PRs:`,
          ...prs.map((pr) => `#   #${pr.number} ${pr.title} (${pr.headRefName})`),
        ];
      } else {
        prLines = [`# OPEN PRs: none`];
      }
    } catch {
      prLines = [`# OPEN PRs: (gh unavailable)`];
    }

    const header = [
      `# REPO: ${repoName}`,
      `# BRANCH: ${branch}`,
      `# vs: main`,
      `#`,
      `# LOCAL BRANCHES:`,
      ...localBranches.map((b) => `#   ${b}`),
      `#`,
      `# REMOTE BRANCHES:`,
      ...remoteBranches.map((b) => `#   ${b}`),
      `#`,
      ...prLines,
      `#`,
    ].join("\n");

    return header + "\n" + diff;
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
