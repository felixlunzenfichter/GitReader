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

test('renderHistoryBlock limits visible task timeline to 6 entries without truncating stored history', () => {
  const original = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, 'utf8') : null;
  const originalSessionsPath = process.env.OPENCLAW_SESSIONS_PATH;
  const originalSessionsDir = process.env.OPENCLAW_SESSIONS_DIR;

  try {
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

    delete require.cache[renderModulePath];
    const { loadTaskHistory, renderHistoryBlock } = require(renderModulePath);

    assert.equal(loadTaskHistory(10).length, 10);

    const block = renderHistoryBlock();
    assert.match(block, /# entries: 6/);
    assert.equal(lineCount(block), 6);
    assert.match(block, /session-9/);
    assert.match(block, /session-4/);
    assert.doesNotMatch(block, /session-3/);
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
    delete require.cache[renderModulePath];
  }
});
