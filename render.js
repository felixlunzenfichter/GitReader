const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const REPOSITORIES = [
  {
    label: "GitReader",
    repoPath: "/Users/felixlunzenfichter/Documents/GitReader",
  },
  {
    label: "ClawContraw",
    repoPath: "/Users/felixlunzenfichter/Documents/ClawContraw",
  },
  {
    label: "Governance",
    repoPath: "/Users/felixlunzenfichter/.openclaw/workspace",
  },
];

function gitExec(cmd, repoPath) {
  return execSync(cmd, { cwd: repoPath, maxBuffer: 1024 * 1024, timeout: 5000 }).toString().trim();
}

function gitExecSafe(cmd, repoPath, fallback = "-") {
  try {
    const out = gitExec(cmd, repoPath);
    return out || fallback;
  } catch {
    return fallback;
  }
}

function loadActiveContexts() {
  // Priority 1: runtime env injection
  const rawEnv = process.env.GITREADER_ACTIVE_CONTEXTS_JSON;
  if (rawEnv) {
    try {
      const parsed = JSON.parse(rawEnv);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Priority 2: local sidecar file maintained by tracked-agent launcher
  const sidecarPath = path.resolve(__dirname, "active-contexts.json");
  try {
    if (fs.existsSync(sidecarPath)) {
      const rawFile = fs.readFileSync(sidecarPath, "utf8");
      const parsed = JSON.parse(rawFile);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  return [];
}

function findActiveContextForRepo(repoPath, branch, activeContexts) {
  return activeContexts.find((ctx) => {
    const cwd = String(ctx.cwd || "");
    const ctxBranch = String(ctx.branch || "");
    const status = String(ctx.status || "").toLowerCase();
    const matchesRepo = cwd === repoPath || (cwd && cwd.startsWith(repoPath + path.sep));
    const matchesBranch = !ctxBranch || ctxBranch === branch;
    const isActiveStatus = !status || ["running", "working", "busy", "idle", "waiting", "error", "blocked"].includes(status);
    return matchesRepo && matchesBranch && isActiveStatus;
  });
}

function truncateMiddle(value, max = 42) {
  const s = String(value || "-");
  if (s.length <= max) return s;
  const left = Math.ceil((max - 1) / 2);
  const right = Math.floor((max - 1) / 2);
  return `${s.slice(0, left)}…${s.slice(s.length - right)}`;
}

function normalizeStatus(status, isActive) {
  const s = String(status || "").toLowerCase();
  if (["error", "failed", "blocked"].includes(s)) return "error";
  if (["waiting", "input", "paused"].includes(s)) return "waiting";
  if (["idle", "sleeping"].includes(s)) return "idle";
  if (["running", "working", "busy"].includes(s)) return "running";
  return isActive ? "running" : "unknown";
}

function statusPresentation(status) {
  switch (status) {
    case "running":
      return { icon: "●", color: "orange" };
    case "idle":
      return { icon: "○", color: "blue-muted" };
    case "waiting":
      return { icon: "◐", color: "yellow" };
    case "error":
      return { icon: "✖", color: "red" };
    default:
      return { icon: "?", color: "gray" };
  }
}

function getGitDiff(repoPath, repoLabel) {
  try {
    const branch = gitExec("git rev-parse --abbrev-ref HEAD", repoPath);
    const repoName = repoLabel || path.basename(repoPath);
    const activeContexts = loadActiveContexts();
    const activeContext = findActiveContextForRepo(repoPath, branch, activeContexts);

    const dirty = gitExecSafe("git status --porcelain", repoPath, "") ? "yes" : "no";
    const lastCommit = gitExecSafe("git log -1 --pretty=format:'%h %s'", repoPath);
    const upstream = gitExecSafe("git rev-parse --abbrev-ref --symbolic-full-name @{u}", repoPath);
    const compareBase = gitExecSafe("git show-ref --verify --quiet refs/heads/main && echo main || echo master", repoPath, "main");

    const localBranches = gitExec("git branch --format='%(refname:short)'", repoPath)
      .split("\n")
      .filter((b) => b);

    const remoteBranches = gitExec("git branch -r --format='%(refname:short)'", repoPath)
      .split("\n")
      .map((b) => b.replace("origin/", ""))
      .filter((b) => b && b !== "HEAD" && b !== "origin");

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

    const active = Boolean(activeContext);
    const agent = activeContext?.agent || "-";
    const activeBranch = activeContext?.branch || branch;
    const agentTask = activeContext?.task ? truncateMiddle(activeContext.task, 120) : "-";

    const header = [
      `# Repository: ${repoName}`,
      `# BRANCH: ${branch}`,
      `# ACTIVE AGENT: ${agent}`,
      `# ACTIVE: ${active ? "yes" : "no"}`,
      `# AGENT BRANCH: ${activeBranch}`,
      `# AGENT TASK: ${agentTask}`,
      `# vs: ${compareBase}`,
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

    const committed = gitExec(`git diff ${compareBase}...HEAD`, repoPath);
    const staged = gitExec("git diff --cached", repoPath);
    const unstaged = gitExec("git diff", repoPath);
    const untracked = gitExec("git status --porcelain --untracked-files=all", repoPath)
      .split("\n")
      .filter((l) => l.startsWith("??"))
      .map((l) => l.slice(3));

    const untrackedWithContent = untracked.map((relPath) => {
      const absPath = path.join(repoPath, relPath);
      let content = "[unreadable]";
      try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) {
          content = "[not a regular file]";
        } else {
          const raw = fs.readFileSync(absPath, "utf8");
          content = raw.length > 4000 ? raw.slice(0, 4000) + "\n...[truncated]" : raw;
        }
      } catch {
        content = "[read failed]";
      }
      return `+  ${relPath}\n-----\n${content}\n-----`;
    });

    const unstagedFiles = gitExec("git diff --name-only", repoPath)
      .split("\n")
      .filter((f) => f);

    const unstagedFullContent = unstagedFiles.map((relPath) => {
      const absPath = path.join(repoPath, relPath);
      let content = "[unreadable]";
      try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) {
          content = "[not a regular file]";
        } else {
          const raw = fs.readFileSync(absPath, "utf8");
          content = raw.length > 4000 ? raw.slice(0, 4000) + "\n...[truncated]" : raw;
        }
      } catch {
        content = "[read failed]";
      }
      return `~  ${relPath}\n-----\n${content}\n-----`;
    });

    const sections = [
      header,
      `# Committed (branch vs ${compareBase})`,
      committed || `[No changes]`,
      `# Staged`,
      staged || `[Nothing staged]`,
      `# Unstaged (diff)`,
      unstaged || `[Clean working tree]`,
      `# Unstaged (full files)`,
      unstagedFullContent.length > 0 ? unstagedFullContent.join("\n") : `[None]`,
      `# Untracked Files`,
      untracked.length > 0 ? untracked.map((f) => `+  ${f}`).join("\n") : `[None]`,
      `# Untracked File Contents`,
      untrackedWithContent.length > 0 ? untrackedWithContent.join("\n") : `[None]`,
    ];

    return sections.join("\n");
  } catch (err) {
    const repoName = repoLabel || path.basename(repoPath);
    return [
      `# Repository: ${repoName}`,
      `# PATH: ${repoPath}`,
      `# ERROR: ${err.message}`,
      `[git diff error: ${err.message}]`,
    ].join("\n");
  }
}

function renderAllRepositories() {
  const repositoriesList = [
    "# All Repositories",
    ...REPOSITORIES.map((repo, index) => `# ${index + 1}. ${repo.label}`),
    "#",
  ].join("\n");

  const sections = REPOSITORIES.map((repo) => getGitDiff(repo.repoPath, repo.label));
  return [repositoriesList, ...sections].join("\n\n");
}

module.exports = { REPOSITORIES, renderAllRepositories };
