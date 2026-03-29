const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('native bridge appends start and finish entries with expected metadata', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-bridge-'));
  const history = path.join(tmp, 'task-history.jsonl');
  const script = path.resolve(__dirname, '..', 'scripts', 'native-subagent-bridge.js');

  execFileSync('node', [script, 'start',
    '--task', 'Test task',
    '--session-key', 'agent:test:123',
    '--run-id', 'run-1',
    '--model', 'opus-4.6',
    '--runtime', 'subagent',
    '--mode', 'run',
    '--cwd', '/tmp/repo',
    '--branch', 'main'
  ], { env: { ...process.env, GITREADER_HISTORY_PATH: history } });

  execFileSync('node', [script, 'finish',
    '--task', 'Test task',
    '--session-key', 'agent:test:123',
    '--run-id', 'run-1',
    '--status', 'inactive',
    '--result', 'ok',
    '--model', 'opus-4.6',
    '--runtime', 'subagent',
    '--mode', 'run',
    '--cwd', '/tmp/repo',
    '--branch', 'main'
  ], { env: { ...process.env, GITREADER_HISTORY_PATH: history } });

  const lines = fs.readFileSync(history, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'task_started');
  assert.equal(lines[0].source, 'native-subagent');
  assert.equal(lines[1].event, 'task_finished');
  assert.equal(lines[1].resultSummary, 'ok');
});
