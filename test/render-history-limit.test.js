const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const historyPath = path.resolve(__dirname, '..', 'task-history.jsonl');
const renderModulePath = path.resolve(__dirname, '..', 'render.js');

function lineCount(block) {
  return block
    .split('\n')
    .filter((line) => line.startsWith('# ') && /^# \d+\./.test(line))
    .length;
}

function withFreshRenderModule(fn) {
  delete require.cache[renderModulePath];
  const mod = require(renderModulePath);
  try {
    fn(mod);
  } finally {
    delete require.cache[renderModulePath];
  }
}

test('native OpenClaw events are the only default task timeline source', () => {
  const original = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, 'utf8') : null;
  const originalSessionsPath = process.env.OPENCLAW_SESSIONS_PATH;
  const originalSessionsDir = process.env.OPENCLAW_SESSIONS_DIR;
  const originalCompat = process.env.GITREADER_ENABLE_COMPAT_TASK_HISTORY;

  try {
    delete process.env.GITREADER_ENABLE_COMPAT_TASK_HISTORY;
    process.env.OPENCLAW_SESSIONS_PATH = path.join(__dirname, 'missing-sessions.json');
    process.env.OPENCLAW_SESSIONS_DIR = path.join(__dirname, 'missing-sessions-dir');

    const entries = Array.from({ length: 10 }, (_, index) => JSON.stringify({
      ts: 1000 + index,
      event: 'task_finished',
      session: `session-${index}`,
      agent: 'test-agent',
      model: 'test-model',
      branch: 'test-branch',
      task: `task ${index}`,
      status: 'inactive',
      source: 'test-source',
      changedFiles: [],
    }));
    fs.writeFileSync(historyPath, `${entries.join('\n')}\n`, 'utf8');

    withFreshRenderModule(({ loadTaskHistory, renderHistoryBlock }) => {
      assert.equal(loadTaskHistory(10).length, 0);
      assert.match(renderHistoryBlock(), /# \[no history yet\]/);
    });
  } finally {
    if (original === null) {
      fs.rmSync(historyPath, { force: true });
    } else {
      fs.writeFileSync(historyPath, original, 'utf8');
    }
    if (originalSessionsPath === undefined) delete process.env.OPENCLAW_SESSIONS_PATH;
    else process.env.OPENCLAW_SESSIONS_PATH = originalSessionsPath;
    if (originalSessionsDir === undefined) delete process.env.OPENCLAW_SESSIONS_DIR;
    else process.env.OPENCLAW_SESSIONS_DIR = originalSessionsDir;
    if (originalCompat === undefined) delete process.env.GITREADER_ENABLE_COMPAT_TASK_HISTORY;
    else process.env.GITREADER_ENABLE_COMPAT_TASK_HISTORY = originalCompat;
    delete require.cache[renderModulePath];
  }
});

test('renderHistoryBlock compatibility fallback can be re-enabled and still limits visible timeline to 6 entries', () => {
  const original = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, 'utf8') : null;
  const originalSessionsPath = process.env.OPENCLAW_SESSIONS_PATH;
  const originalSessionsDir = process.env.OPENCLAW_SESSIONS_DIR;
  const originalCompat = process.env.GITREADER_ENABLE_COMPAT_TASK_HISTORY;

  try {
    process.env.GITREADER_ENABLE_COMPAT_TASK_HISTORY = '1';
    process.env.OPENCLAW_SESSIONS_PATH = path.join(__dirname, 'missing-sessions.json');
    process.env.OPENCLAW_SESSIONS_DIR = path.join(__dirname, 'missing-sessions-dir');
    const entries = Array.from({ length: 10 }, (_, index) => JSON.stringify({
      ts: 1000 + index,
      event: 'task_finished',
      session: `session-${index}`,
      agent: 'test-agent',
      model: 'test-model',
      branch: 'test-branch',
      task: `task ${index}`,
      status: 'inactive',
      source: 'test-source',
      changedFiles: [],
    }));
    fs.writeFileSync(historyPath, `${entries.join('\n')}\n`, 'utf8');

    withFreshRenderModule(({ loadTaskHistory, renderHistoryBlock }) => {
      assert.equal(loadTaskHistory(10).length, 10);

      const block = renderHistoryBlock();
      assert.match(block, /# entries: 6/);
      assert.equal(lineCount(block), 6);
      assert.match(block, /session-9/);
      assert.match(block, /session-4/);
      assert.doesNotMatch(block, /session-3/);
    });
  } finally {
    if (original === null) {
      fs.rmSync(historyPath, { force: true });
    } else {
      fs.writeFileSync(historyPath, original, 'utf8');
    }
    if (originalSessionsPath === undefined) {
      delete process.env.OPENCLAW_SESSIONS_PATH;
    } else {
      process.env.OPENCLAW_SESSIONS_PATH = originalSessionsPath;
    }
    if (originalSessionsDir === undefined) {
      delete process.env.OPENCLAW_SESSIONS_DIR;
    } else {
      process.env.OPENCLAW_SESSIONS_DIR = originalSessionsDir;
    }
    if (originalCompat === undefined) {
      delete process.env.GITREADER_ENABLE_COMPAT_TASK_HISTORY;
    } else {
      process.env.GITREADER_ENABLE_COMPAT_TASK_HISTORY = originalCompat;
    }
    delete require.cache[renderModulePath];
  }
});
