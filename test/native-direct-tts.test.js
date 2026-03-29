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

test('server speaks direct native OpenClaw events from session store', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-direct-tts-'));
  const sessionsDir = path.join(tmp, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const historyPath = path.join(tmp, 'task-history.jsonl');
  fs.writeFileSync(historyPath, '');

  const sessionId = 'session-tts-123';
  const sessionKey = 'agent:main:subagent:tts-123';
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
  const sessionsJson = path.join(sessionsDir, 'sessions.json');
  fs.writeFileSync(sessionFile, [
    JSON.stringify({
      type: 'message',
      message: { content: [{ type: 'text', text: '[Subagent Task]: Native direct TTS proof\n\nGoal: speak aloud' }] }
    }),
    JSON.stringify({
      type: 'message',
      message: { content: [{ type: 'text', text: 'Native direct task finished cleanly.' }] }
    })
  ].join('\n'));
  fs.writeFileSync(sessionsJson, JSON.stringify({
    [sessionKey]: {
      sessionId,
      sessionFile,
      startedAt: Date.now() - 1000,
      updatedAt: Date.now(),
      status: 'done',
      label: 'fallback-label',
      model: 'gpt-5.4',
      spawnedWorkspaceDir: '/tmp/workspace',
      spawnDepth: 1,
      subagentRole: 'subagent'
    }
  }, null, 2));

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
  await waitFor(() => logs.includes('Started TTS — event: task_started, task: "Native direct TTS proof"'));
  await waitFor(() => logs.includes('Started TTS — event: task_finished, task: "Native direct TTS proof"'));
  await waitFor(() => logs.includes('OK(STUB):'));

  assert.match(logs, /Started TTS — event: task_started, task: "Native direct TTS proof"/);
  assert.match(logs, /Started TTS — event: task_finished, task: "Native direct TTS proof"/);
  assert.match(logs, /request: "Started: Native direct TTS proof"/);
  assert.match(logs, /request: "Finished: Native direct TTS proof"/);
});
