const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function waitFor(predicate, timeoutMs = 8000, intervalMs = 100) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch {}
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('timed out waiting for condition'));
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeSession({ sessionsDir, sessionId, sessionKey, task, resultText, startedAt, updatedAt, status }) {
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
  const transcript = [
    JSON.stringify({
      type: 'message',
      message: { content: [{ type: 'text', text: `[Subagent Task]: ${task}\n\nGoal: speak aloud` }] }
    })
  ];

  if (resultText) {
    transcript.push(JSON.stringify({
      type: 'message',
      message: { content: [{ type: 'text', text: resultText }] }
    }));
  }

  fs.writeFileSync(sessionFile, transcript.join('\n'));
  return {
    [sessionKey]: {
      sessionId,
      sessionFile,
      startedAt,
      updatedAt,
      status,
      label: `label-${sessionId}`,
      model: 'gpt-5.4',
      spawnedWorkspaceDir: '/tmp/workspace',
      spawnDepth: 1,
      subagentRole: 'subagent'
    }
  };
}

test('server ignores backfilled native events at startup and only speaks fresh ones', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-direct-tts-'));
  const sessionsDir = path.join(tmp, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const historyPath = path.join(tmp, 'task-history.jsonl');
  fs.writeFileSync(historyPath, '');
  const sessionsJson = path.join(sessionsDir, 'sessions.json');

  const historicalSession = writeSession({
    sessionsDir,
    sessionId: 'session-old-123',
    sessionKey: 'agent:main:subagent:old-123',
    task: 'Historical native task',
    resultText: 'Historical native task finished before launch.',
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now() - 55_000,
    status: 'done'
  });
  fs.writeFileSync(sessionsJson, JSON.stringify(historicalSession, null, 2));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '19876',
      GITREADER_HISTORY_PATH: historyPath,
      OPENCLAW_SESSIONS_PATH: sessionsJson,
      OPENCLAW_SESSIONS_DIR: sessionsDir,
      GITREADER_TTS_STUB: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

  t.after(() => {
    child.kill('SIGTERM');
  });

  await waitFor(() => logs.includes('WebSocket server on ws://0.0.0.0:19876'));
  await waitFor(() => logs.includes('only fresh events after launch will be spoken'));
  await sleep(2500);
  assert.doesNotMatch(logs, /Historical native task/);

  const freshSessionKey = 'agent:main:subagent:fresh-123';
  const freshSessionId = 'session-fresh-123';
  const freshStartedAt = Date.now();
  fs.writeFileSync(sessionsJson, JSON.stringify(writeSession({
    sessionsDir,
    sessionId: freshSessionId,
    sessionKey: freshSessionKey,
    task: 'Fresh native task',
    startedAt: freshStartedAt,
    updatedAt: freshStartedAt,
    status: 'running'
  }), null, 2));

  await waitFor(() => logs.includes('Started TTS — event: task_started, task: "Fresh native task"'));
  assert.match(logs, /request: "Started: Fresh native task"/);

  fs.writeFileSync(sessionsJson, JSON.stringify(writeSession({
    sessionsDir,
    sessionId: freshSessionId,
    sessionKey: freshSessionKey,
    task: 'Fresh native task',
    resultText: 'Fresh native task finished cleanly.',
    startedAt: freshStartedAt,
    updatedAt: freshStartedAt + 1000,
    status: 'done'
  }), null, 2));

  await waitFor(() => logs.includes('Started TTS — event: task_finished, task: "Fresh native task"'));
  assert.match(logs, /request: "Finished: Fresh native task"/);
});
