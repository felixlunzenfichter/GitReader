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

function readFileContent(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return "[not a regular file]";
    const raw = fs.readFileSync(absPath, "utf8");
    return raw.length > 4000 ? raw.slice(0, 4000) + "\n...[truncated]" : raw;
  } catch {
    return "[read failed]";
  }
}

function truncateMiddle(value, max = 42) {
  const s = String(value || "-");
  if (s.length <= max) return s;
  const left = Math.ceil((max - 1) / 2);
  const right = Math.floor((max - 1) / 2);
  return `${s.slice(0, left)}…${s.slice(s.length - right)}`;
}

function detectCompareBase(repoPath) {
  return gitExecSafe("git show-ref --verify --quiet refs/heads/main && echo main || echo master", repoPath, "main");
}

function getGitDiff(repoPath, repoLabel) {
  try {
    const branch = gitExec("git rev-parse --abbrev-ref HEAD", repoPath);
    const repoName = repoLabel || path.basename(repoPath);
    const compareBase = detectCompareBase(repoPath);

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

    const header = [
      `# Repository: ${repoName}`,
      `# BRANCH: ${branch}`,
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
      const content = readFileContent(path.join(repoPath, relPath));
      return `+  ${relPath}\n-----\n${content}\n-----`;
    });

    const unstagedFiles = gitExec("git diff --name-only", repoPath)
      .split("\n")
      .filter((f) => f);

    const unstagedFullContent = unstagedFiles.map((relPath) => {
      const content = readFileContent(path.join(repoPath, relPath));
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

function loadTaskHistory(limit = 20) {
  const p = path.resolve(__dirname, "task-history.jsonl");
  try {
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
    const parsed = lines.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    return parsed.slice(-limit).reverse();
  } catch {
    return [];
  }
}

function renderTaskFinishedExtra(entry) {
  const extra = [];
  if (!("changedFiles" in entry)) {
    extra.push("#    changes: [not tracked]");
  } else {
    const files = Array.isArray(entry.changedFiles) ? entry.changedFiles : [];
    if (files.length > 0) {
      extra.push(`#    changes: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ` (+${files.length - 8} more)` : ''}`);
    } else {
      extra.push("#    changes: [none]");
    }
  }
  if (entry.resultSummary) {
    extra.push(`#    result: ${entry.resultSummary}`);
  }
  if (entry.diffPreview) {
    const MAX_RENDER = 20;
    const diffLines = entry.diffPreview.split("\n");
    const shown = diffLines.slice(0, MAX_RENDER);
    shown.forEach(line => extra.push(`#    ${line}`));
    if (diffLines.length > MAX_RENDER) {
      extra.push(`#    [... ${diffLines.length - MAX_RENDER} more diff lines]`);
    }
  }
  return extra;
}

function renderHistoryBlock() {
  const history = loadTaskHistory(25);
  const header = [
    "# OpenClaw Task Timeline",
    `# entries: ${history.length}`,
    "#",
  ];

  const lines = history.flatMap((h, i) => {
    const when = new Date(Number(h.ts || 0)).toISOString();
    const task = truncateMiddle(h.task || "-", 120);
    const model = h.model || "-";
    const source = h.source || "tracked-worker";
    const runtimeBadge = h.runtime ? `[${h.runtime}]` : "";
    const runIdBadge = h.runId ? `[run:${truncateMiddle(h.runId, 16)}]` : "";
    const sessionKeyBadge = h.session_key ? `[sk:${truncateMiddle(h.session_key, 18)}]` : "";
    const main = `# ${i + 1}. [${h.event}] [${h.status}] [${source}] [${h.agent}] [${model}] ${runtimeBadge} ${runIdBadge} ${sessionKeyBadge} [${h.session}] [${h.branch}] ${when} :: ${task}`.replace(/\s+/g, ' ').trim();
    const extra = h.event === "task_finished" ? renderTaskFinishedExtra(h) : [];
    return [main, ...extra];
  });

  return [...header, ...(lines.length ? lines : ["# [no history yet]"]), "#"].join("\n");
}

function renderAllRepositories() {
  const historyBlock = renderHistoryBlock();
  const repositoriesList = [
    "# All Repositories",
    ...REPOSITORIES.map((repo, index) => `# ${index + 1}. ${repo.label}`),
    "#",
  ].join("\n");

  const sections = REPOSITORIES.map((repo) => getGitDiff(repo.repoPath, repo.label));
  return [historyBlock, repositoriesList, ...sections].join("\n\n");
}

module.exports = { REPOSITORIES, renderAllRepositories };
