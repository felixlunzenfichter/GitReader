const MESSAGES = {
  task_started: (title) => `Started: ${title}`,
  task_finished: (title) => `Finished: ${title}`,
};

async function announceTaskEvent({ event, task }, speak) {
  const fmt = MESSAGES[event];
  if (!fmt) return;
  await speak(fmt(task));
}

async function speakWithOpenAI(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI TTS failed: ${res.status} ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { announceTaskEvent, speakWithOpenAI };
