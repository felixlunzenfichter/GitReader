const test = require('node:test');
const assert = require('node:assert/strict');
const { TTSQueue, stableEventKey, collapseBurst } = require('../tts-queue.js');

function event(overrides = {}) {
  return {
    event: 'task_started',
    status: 'running',
    source: 'openclaw-native-events',
    session: 'agent:main:subagent:test',
    session_key: 'agent:main:subagent:test',
    runId: 'run-1',
    task: 'Example task',
    ts: 1000,
    ...overrides,
  };
}

test('stableEventKey ignores timestamp churn for same lifecycle event', () => {
  const a = event({ ts: 1000 });
  const b = event({ ts: 9999 });
  assert.equal(stableEventKey(a), stableEventKey(b));
});

test('collapseBurst removes start/finish pairs for extremely short tasks', () => {
  const started = event({ event: 'task_started', status: 'running', ts: 1000 });
  const finished = event({ event: 'task_finished', status: 'inactive', ts: 2200 });
  assert.deepEqual(collapseBurst([started, finished], 2500), []);
});

test('TTSQueue dedupes repeated lifecycle events and preserves FIFO order', async () => {
  const spoken = [];
  const skipped = [];
  const queue = new TTSQueue({
    speakEvent: async (entry) => {
      spoken.push(`start:${entry.task}`);
      await new Promise((resolve) => setTimeout(resolve, entry.delayMs || 10));
      spoken.push(`finish:${entry.task}`);
    },
    onSkip: (info) => skipped.push(info.reason),
  });

  const first = event({ task: 'First', runId: 'run-1', ts: 1000, delayMs: 40 });
  const duplicate = event({ task: 'First', runId: 'run-1', ts: 5000, delayMs: 1 });
  const second = event({ task: 'Second', runId: 'run-2', session: 'agent:main:subagent:test-2', session_key: 'agent:main:subagent:test-2', ts: 1100, delayMs: 1 });

  assert.equal(queue.enqueue(first), true);
  assert.equal(queue.enqueue(duplicate), false);
  assert.equal(queue.enqueue(second), true);

  while (queue.processing || queue.pending.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(skipped, ['duplicate']);
  assert.deepEqual(spoken, [
    'start:First',
    'finish:First',
    'start:Second',
    'finish:Second',
  ]);
});
