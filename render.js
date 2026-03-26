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

function getGitDiff(repoPath, repoLabel) {
  try {
    const branch = gitExec("git rev-parse --abbrev-ref HEAD", repoPath);
    const repoName = repoLabel || path.basename(repoPath);

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

    const committed = gitExec("git diff main...HEAD", repoPath);
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
      `# Committed (branch vs main)`,
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
