const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Task lifecycle TTS: when a task starts or finishes, the system should
// synthesize a spoken announcement with the task title.
//
// This module does not exist yet — the require will fail, which is the
// RED phase of TDD.

const { announceTaskEvent } = require("../tts.js");

describe("task lifecycle TTS announcements", () => {
  it("announces 'Started: <title>' on task_started", async () => {
    const calls = [];
    const fakeTTS = (text) => calls.push(text);

    await announceTaskEvent(
      { event: "task_started", task: "implement login flow" },
      fakeTTS,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0], "Started: implement login flow");
  });

  it("announces 'Finished: <title>' on task_finished", async () => {
    const calls = [];
    const fakeTTS = (text) => calls.push(text);

    await announceTaskEvent(
      { event: "task_finished", task: "implement login flow" },
      fakeTTS,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0], "Finished: implement login flow");
  });

  it("does nothing for unknown events", async () => {
    const calls = [];
    const fakeTTS = (text) => calls.push(text);

    await announceTaskEvent(
      { event: "task_updated", task: "whatever" },
      fakeTTS,
    );

    assert.equal(calls.length, 0);
  });
});
