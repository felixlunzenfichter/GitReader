const MESSAGES = {
  task_started: (title) => `Started: ${title}`,
  task_finished: (title) => `Finished: ${title}`,
};

async function announceTaskEvent({ event, task }, speak) {
  const fmt = MESSAGES[event];
  if (!fmt) return null;
  return await speak(fmt(task));
}

async function speakWithOpenAI(text) {
  console.log(`[TTS] request: "${text}"`);
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[TTS] FAIL: OPENAI_API_KEY not set");
    throw new Error("OPENAI_API_KEY not set");
  }

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[TTS] FAIL: HTTP ${res.status} — ${body}`);
    throw new Error(`OpenAI TTS failed: ${res.status} ${body}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[TTS] OK: ${buf.length} bytes for "${text}"`);
  return buf;
}

module.exports = { announceTaskEvent, speakWithOpenAI };
