function stableEventKey(entry) {
  return [
    entry.source || '-',
    entry.event || '-',
    entry.session_key || entry.session || '-',
    entry.runId || '-',
    entry.status || '-',
    entry.task || '-',
  ].join('|');
}

function collapseBurst(entries, shortTaskThresholdMs = 2500) {
  const collapsed = [];

  for (const entry of entries) {
    const previous = collapsed[collapsed.length - 1];
    const sameRun = previous
      && previous.event === 'task_started'
      && entry.event === 'task_finished'
      && (previous.session_key || previous.session || '-') === (entry.session_key || entry.session || '-')
      && (previous.runId || '-') === (entry.runId || '-')
      && (previous.task || '-') === (entry.task || '-');

    const previousTs = Number(previous?.ts || 0);
    const currentTs = Number(entry?.ts || 0);
    const elapsedMs = currentTs - previousTs;

    if (sameRun && previousTs > 0 && currentTs >= previousTs && elapsedMs <= shortTaskThresholdMs) {
      collapsed.pop();
      continue;
    }

    collapsed.push(entry);
  }

  return collapsed;
}

class TTSQueue {
  constructor({ speakEvent, onSkip, shortTaskThresholdMs = 2500 }) {
    this.speakEvent = speakEvent;
    this.onSkip = onSkip || (() => {});
    this.shortTaskThresholdMs = shortTaskThresholdMs;
    this.seenKeys = new Set();
    this.pending = [];
    this.processing = false;
  }

  seed(entries) {
    for (const entry of entries) {
      this.seenKeys.add(stableEventKey(entry));
    }
  }

  enqueue(entry) {
    const key = stableEventKey(entry);
    if (this.seenKeys.has(key)) {
      this.onSkip({ reason: 'duplicate', entry, key });
      return false;
    }
    this.seenKeys.add(key);

    const previous = this.pending[this.pending.length - 1];
    const maybeCollapsed = collapseBurst([previous, entry], this.shortTaskThresholdMs);
    if (previous && maybeCollapsed.length === 0) {
      this.pending.pop();
      this.onSkip({ reason: 'collapsed_short_task', entry, key, previous });
      return false;
    }

    this.pending.push(entry);
    this.process().catch(() => {});
    return true;
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.pending.length > 0) {
        const entry = this.pending.shift();
        await this.speakEvent(entry);
      }
    } finally {
      this.processing = false;
    }
  }
}

module.exports = { stableEventKey, collapseBurst, TTSQueue };
