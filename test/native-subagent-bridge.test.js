const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const renderPath = path.resolve(__dirname, '..', 'render.js');

function withFreshRenderModule(fn) {
  delete require.cache[renderPath];
  const mod = require(renderPath);
  try {
    fn(mod);
  } finally {
    delete require.cache[renderPath];
  }
}

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

test('direct OpenClaw session store produces native lifecycle timeline entries', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-openclaw-'));
  const sessionsDir = path.join(tmp, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });

  const sessionId = 'session-123';
  const sessionKey = 'agent:main:subagent:abc';
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
  const sessionsJson = path.join(sessionsDir, 'sessions.json');

  fs.writeFileSync(sessionFile, [
    JSON.stringify({
      type: 'message',
      message: {
        content: [
          { type: 'text', text: '[Subagent Task]: Inspect repo and wire direct native events\n\nGoal: done' }
        ]
      }
    }),
    JSON.stringify({
      type: 'message',
      message: {
        content: [
          { type: 'text', text: 'Implemented direct bridge and verified timeline visibility on iPad logs.' }
        ]
      }
    })
  ].join('\n'));

  fs.writeFileSync(sessionsJson, JSON.stringify({
    [sessionKey]: {
      sessionId,
      sessionFile,
      startedAt: 1000,
      updatedAt: 2000,
      status: 'done',
      label: 'fallback-label',
      model: 'gpt-5.4',
      spawnedWorkspaceDir: '/tmp/workspace',
      spawnDepth: 1,
      subagentRole: 'leaf'
    }
  }, null, 2));

  const prevSessionsPath = process.env.OPENCLAW_SESSIONS_PATH;
  const prevSessionsDir = process.env.OPENCLAW_SESSIONS_DIR;
  process.env.OPENCLAW_SESSIONS_PATH = sessionsJson;
  process.env.OPENCLAW_SESSIONS_DIR = sessionsDir;

  try {
    withFreshRenderModule(({ loadNativeOpenClawEvents }) => {
      const events = loadNativeOpenClawEvents(10);
      assert.equal(events.length, 2);
      assert.equal(events[0].event, 'task_started');
      assert.equal(events[0].source, 'openclaw-native-events');
      assert.equal(events[0].task, 'Inspect repo and wire direct native events');
      assert.equal(events[1].event, 'task_finished');
      assert.equal(events[1].status, 'inactive');
      assert.match(events[1].resultSummary, /Implemented direct bridge/);
    });
  } finally {
    if (prevSessionsPath === undefined) delete process.env.OPENCLAW_SESSIONS_PATH;
    else process.env.OPENCLAW_SESSIONS_PATH = prevSessionsPath;
    if (prevSessionsDir === undefined) delete process.env.OPENCLAW_SESSIONS_DIR;
    else process.env.OPENCLAW_SESSIONS_DIR = prevSessionsDir;
  }
});
