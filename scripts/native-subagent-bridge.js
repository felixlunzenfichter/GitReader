#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function getArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function usage() {
  console.error(`Usage:
  node scripts/native-subagent-bridge.js start \
    --task "..." --session-key "..." [--run-id "..."] [--model "opus-4.6"] [--runtime "subagent"] [--mode "run"] [--cwd "..."] [--branch "..."]

  node scripts/native-subagent-bridge.js finish \
    --task "..." --session-key "..." [--run-id "..."] [--status "inactive|failed"] [--result "short summary"] [--model "..."] [--runtime "..."] [--mode "..."] [--cwd "..."] [--branch "..."]
`);
  process.exit(1);
}

const action = process.argv[2];
if (!action || !["start", "finish"].includes(action)) usage();

const task = getArg("--task");
const sessionKey = getArg("--session-key");
if (!task || !sessionKey) usage();

const historyPath = process.env.GITREADER_HISTORY_PATH || path.resolve(__dirname, "..", "task-history.jsonl");
const now = Date.now();

const base = {
  ts: now,
  event: action === "start" ? "task_started" : "task_finished",
  session: sessionKey,
  session_key: sessionKey,
  runId: getArg("--run-id", ""),
  agent: "native-subagent",
  model: getArg("--model", "-"),
  runtime: getArg("--runtime", "subagent"),
  mode: getArg("--mode", "run"),
  cwd: getArg("--cwd", "-"),
  branch: getArg("--branch", "-"),
  task,
  source: "native-subagent",
  changedFiles: [],
};

if (action === "start") {
  base.status = "running";
} else {
  base.status = getArg("--status", "inactive");
  const resultSummary = getArg("--result", "");
  if (resultSummary) base.resultSummary = resultSummary;
}

fs.appendFileSync(historyPath, JSON.stringify(base) + "\n", "utf8");
console.log(`${base.event} appended -> ${historyPath}`);
