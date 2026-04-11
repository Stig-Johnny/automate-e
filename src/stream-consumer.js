import Redis from 'ioredis';

/**
 * Valkey/Redis Stream consumer for agent assignments.
 * Replaces cron polling with event-driven consumption.
 *
 * Uses XREADGROUP with BLOCK to wait for new messages (zero cost when idle).
 * On startup, processes any pending (unacked) messages first.
 */
export function createStreamConsumer(character, agent, dashboard, discordClient) {
  const valkeyUrl = process.env.VALKEY_URL;
  const agentId = process.env.AGENT_ID || character.heartbeat?.agentId;

  if (!valkeyUrl || !agentId) {
    console.log('[Stream] Not configured (VALKEY_URL or AGENT_ID missing)');
    return null;
  }

  const streamKey = `assignments:${agentId}`;
  const groupName = 'agents';
  const consumerName = agentId;
  let redis;
  let running = false;
  let processing = false;

  async function connect() {
    redis = new Redis(valkeyUrl);

    // Create consumer group if it doesn't exist
    try {
      await redis.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
      console.log(`[Stream] Created consumer group ${groupName} on ${streamKey}`);
    } catch (err) {
      if (!err.message.includes('BUSYGROUP')) throw err;
      // Group already exists — fine
    }

    console.log(`[Stream] Connected to ${valkeyUrl}, consuming ${streamKey}`);
    return redis;
  }

  async function processMessage(id, fields) {
    const assignment = {};
    for (let i = 0; i < fields.length; i += 2) {
      assignment[fields[i]] = fields[i + 1];
    }

    const { repo, issueNumber, title, priority } = assignment;
    console.log(`[Stream] Assignment received: ${repo}#${issueNumber} — ${title}`);
    dashboard?.addLog('info', `Stream: assignment ${repo}#${issueNumber}`);

    // Try to post to Discord (non-fatal if thread creation fails)
    const channelId = character.cron?.channelId;
    let thread = null;
    if (channelId && discordClient) {
      try {
        const channel = await discordClient.channels.fetch(channelId);
        if (channel) {
          const msg = await channel.send(`🔧 **${character.name}** working on ${repo}#${issueNumber} — ${title?.slice(0, 80)}`);
          thread = await msg.startThread({
            name: `${repo}#${issueNumber} — ${title?.slice(0, 40)}`,
            autoArchiveDuration: 4320,
          });
        }
      } catch (err) {
        console.warn(`[Stream] Discord thread failed (non-fatal): ${err.message}`);
      }
    }

    // Run the agent — always, even if Discord thread failed
    process.env.CONDUCTOR_REPO = repo;
    process.env.CONDUCTOR_ISSUE_NUMBER = issueNumber;

    try {
      const prompt = `You have been assigned: ${repo}#${issueNumber} — ${title}\n\n${assignment.body || ''}\n\nImplement this task. Read the issue on GitHub for full context. Create a feature branch, implement the fix, commit, push, and create a PR with "Closes #${issueNumber}" in the body.`;
      const response = await agent.process(prompt, {
        userId: 'stream-consumer',
        userName: character.name,
        channelId: channelId || 'stream',
        threadId: `stream-${repo}-${issueNumber}`,
        attachments: [],
      }, dashboard);

      if (response?.trim() && response.trim().length > 20 && thread) {
        try { await thread.send(response.slice(0, 2000)); } catch {}
      }
    } catch (err) {
      console.error(`[Stream] Agent error on ${repo}#${issueNumber}: ${err.message}`);
      delete process.env.CONDUCTOR_REPO;
      delete process.env.CONDUCTOR_ISSUE_NUMBER;
      return; // Don't ACK — retry later
    }

    delete process.env.CONDUCTOR_REPO;
    delete process.env.CONDUCTOR_ISSUE_NUMBER;

    // ACK the message
    await redis.xack(streamKey, groupName, id);
    console.log(`[Stream] ACK ${id} — ${repo}#${issueNumber} done`);
    dashboard?.addLog('info', `Stream: ACK ${repo}#${issueNumber}`);
  }

  async function processPending() {
    // Check for unacked messages from previous runs
    const pending = await redis.xreadgroup('GROUP', groupName, consumerName, 'COUNT', 10, 'STREAMS', streamKey, '0');
    if (!pending || !pending[0] || !pending[0][1].length) return;

    console.log(`[Stream] Processing ${pending[0][1].length} pending messages`);
    for (const [id, fields] of pending[0][1]) {
      if (fields.length === 0) {
        // Already acked but still in PEL — skip
        await redis.xack(streamKey, groupName, id);
        continue;
      }
      await processMessage(id, fields);
    }
  }

  async function consumeLoop() {
    running = true;

    // Process any pending messages first
    await processPending();

    // Block-wait for new messages
    while (running) {
      try {
        const result = await redis.xreadgroup(
          'GROUP', groupName, consumerName,
          'BLOCK', 30000, // 30s block timeout (reconnect periodically)
          'COUNT', 1,
          'STREAMS', streamKey, '>',
        );

        if (!result || !result[0] || !result[0][1].length) continue;

        processing = true;
        const [id, fields] = result[0][1][0];
        await processMessage(id, fields);
        processing = false;
      } catch (err) {
        if (!running) break;
        console.error(`[Stream] Error: ${err.message}, reconnecting in 5s`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  return {
    async start() {
      try {
        await connect();
        consumeLoop().catch(err => console.error(`[Stream] Fatal: ${err.message}`));
        return true;
      } catch (err) {
        console.error(`[Stream] Failed to start: ${err.message}`);
        return false;
      }
    },
    stop() {
      running = false;
      redis?.disconnect();
    },
    isProcessing() { return processing; },
  };
}
