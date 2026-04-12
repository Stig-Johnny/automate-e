/**
 * Heartbeat — periodically sends agent status to a configured endpoint.
 *
 * Built into the runtime, not the LLM. Fires automatically every N seconds.
 *
 * character.json config:
 * {
 *   "heartbeat": {
 *     "url": "http://conductor-e-api:8080/api/events",
 *     "intervalSeconds": 60,
 *     "agentId": "conductor-e"
 *   }
 * }
 */

export function startHeartbeat(character, options = {}) {
  const config = character.heartbeat;
  if (!config?.url || !config?.agentId) return null;

  // Unique instance ID: agentId + short pod hostname (e.g. dev-e-node/abc12)
  const hostname = (process.env.HOSTNAME || require('os').hostname() || '').slice(-5);
  const instanceId = hostname ? `${config.agentId}/${hostname}` : config.agentId;

  const intervalMs = (config.intervalSeconds || 60) * 1000;
  let currentStatus = 'idle';
  let currentIssue = null;
  let currentRepo = null;

  const send = async () => {
    try {
      const snapshot = options.getSnapshot ? await options.getSnapshot() : {};
      const body = {
        type: 'HEARTBEAT',
        agentId: instanceId,
        status: currentStatus,
        currentIssue,
        currentRepo,
        activeProvider: snapshot.activeProvider || null,
        availableProviders: snapshot.availableProviders || [],
        providers: snapshot.providers || [],
        integrations: snapshot.integrations || [],
      };

      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error(`[Heartbeat] Failed: ${res.status}`);
      }
    } catch (err) {
      console.error(`[Heartbeat] Error: ${err.message}`);
    }
  };

  // Send immediately, then on interval
  send();
  const timer = setInterval(send, intervalMs);

  console.log(`[Heartbeat] ${instanceId} → ${config.url} every ${config.intervalSeconds}s`);

  return {
    setStatus(status, issue = null, repo = null) {
      currentStatus = status;
      currentIssue = issue;
      currentRepo = repo;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
