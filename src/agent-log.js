/**
 * Agent log publisher — streams agent activity to Valkey pub/sub
 * and Conductor-E API for dashboard visibility.
 *
 * Two channels:
 * - Valkey pub/sub "logs:{agentId}" — real-time streaming to dashboard SSE
 * - Conductor-E POST /api/agent-logs — persistent history
 */

import Redis from 'ioredis';

const VALKEY_URL = process.env.VALKEY_URL;
const CONDUCTOR_URL = process.env.CONDUCTOR_BASE_URL || process.env.CONDUCTOR_URL;
const AGENT_ID = process.env.AGENT_ID;

let redis = null;
let buffer = [];
const FLUSH_INTERVAL = 2000; // flush buffered lines every 2s

function getRedis() {
  if (!redis && VALKEY_URL) {
    redis = new Redis(VALKEY_URL);
    redis.on('error', () => {}); // non-fatal
  }
  return redis;
}

/**
 * Publish a log line. Non-blocking, fire-and-forget.
 */
export function publishLog(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    agentId: AGENT_ID,
    level, // info, warn, error, progress, cli-stderr
    message,
    ...meta, // repo, issueNumber, etc.
  };

  // Publish to Valkey pub/sub (real-time)
  const r = getRedis();
  if (r) {
    r.publish(`logs:${AGENT_ID}`, JSON.stringify(entry)).catch(() => {});
  }

  // Buffer for batch POST to Conductor-E (history)
  buffer.push(entry);
}

/**
 * Flush buffered logs to Conductor-E API.
 */
async function flushLogs() {
  if (!buffer.length || !CONDUCTOR_URL || !AGENT_ID) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await fetch(`${CONDUCTOR_URL}/api/agent-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: AGENT_ID, entries: batch }),
    });
  } catch {
    // Non-fatal — logs are best-effort
  }
}

// Auto-flush periodically
setInterval(flushLogs, FLUSH_INTERVAL);

// Flush on exit
process.on('beforeExit', flushLogs);
