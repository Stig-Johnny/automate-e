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

    const { repo, issueNumber, title, priority, stack, testCommand, buildCommand, tools } = assignment;
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

    // Clear KEDA signal list (tells KEDA we're processing the work)
    try { await redis.del(`signal:${agentId}`); } catch {}

    // Create execution log in Conductor-E
    const conductorUrl = process.env.CONDUCTOR_BASE_URL || process.env.CONDUCTOR_URL;
    let executionLogId = null;
    if (conductorUrl) {
      try {
        const res = await fetch(`${conductorUrl}/api/execution-logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo, issueNumber: parseInt(issueNumber), agentId,
            status: 'running', model: character.llm?.model || 'unknown',
            steps: [{ type: 'assigned', status: 'completed', detail: `Assigned to ${agentId}` }],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          executionLogId = data.id;
          console.log(`[Stream] Execution log created: ${executionLogId}`);
        }
      } catch (err) { console.warn(`[Stream] Failed to create execution log: ${err.message}`); }
    }

    // Helper to append step to execution log
    const logStep = async (type, status, detail, costUsd, turns) => {
      if (!executionLogId || !conductorUrl) return;
      try {
        await fetch(`${conductorUrl}/api/execution-logs/${executionLogId}/steps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, status, detail, costUsd, turns }),
        });
      } catch {}
    };

    // Run the agent — always, even if Discord thread failed
    process.env.CONDUCTOR_REPO = repo;
    process.env.CONDUCTOR_ISSUE_NUMBER = issueNumber;

    try {
      // Check for existing session (for iteration/resumption)
      const sessionKey = `session:${repo}#${issueNumber}`;
      let existingSessionId = null;
      try { existingSessionId = await redis.get(sessionKey); } catch {}

      const isIteration = !!existingSessionId;

      // Build tool context
      let toolContext = '';
      if (tools) {
        const toolList = tools.split(',').map(t => t.trim()).filter(Boolean);
        if (toolList.length > 0) {
          toolContext = `\n\n## Required tools\nInstall before starting: ${toolList.map(t => `\`${t}\``).join(', ')}\nUse npm/pip/apt as appropriate for your stack (${stack || 'node'}).`;
        }
      }
      if (testCommand) toolContext += `\n\n## Test command\n\`${testCommand}\` — run this before pushing.`;
      if (buildCommand) toolContext += `\n\n## Build command\n\`${buildCommand}\` — verify build passes.`;

      // Always allow runtime installs
      toolContext += '\n\n## Runtime installs\nIf you need a tool that is not installed, install it yourself (npm install -g, pip install, apt-get install). You have sudo access for apt-get. Prefer global installs so they persist for the session.';

      const taskPrompt = `You have been assigned: ${repo}#${issueNumber} — ${title}

## Issue
${assignment.body || title}
${toolContext}

## MANDATORY steps — you MUST complete ALL of these:

1. Clone the repo: git clone https://github.com/${repo}.git && cd ${repo.split('/')[1]}
2. Create feature branch: git checkout -b feature/issue-${issueNumber}-$(echo "${title}" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | head -c 30)
3. Read the issue on GitHub for full context
4. Implement the changes
5. Run tests if available: check .rig-agent.yaml for testCommand
6. Commit with conventional commits (feat:, fix:, docs:, etc.)
7. Push: git push -u origin HEAD
8. Create PR: gh pr create --title "${title}" --body "Closes #${issueNumber}" --base main

## CRITICAL RULES:
- You are NOT done until the PR is created. If you stop before creating a PR, you have FAILED.
- Do NOT wait for Discord threads, webhooks, or external events.
- Do NOT ask questions — make reasonable decisions and implement.
- If git push fails, check credentials and retry.
- If gh pr create fails, check the error and fix it.`;

      const prompt = isIteration
        ? `Continue working on ${repo}#${issueNumber}. Address the feedback and push to the existing branch.\n\n${assignment.body || title}${toolContext}`
        : taskPrompt;

      const freshPrompt = taskPrompt;

      if (isIteration) {
        console.log(`[Stream] Resuming session ${existingSessionId} for ${repo}#${issueNumber}`);
      }

      let response;
      try {
        response = await agent.process(prompt, {
          userId: 'stream-consumer',
          userName: character.name,
          channelId: channelId || 'stream',
          threadId: `stream-${repo}-${issueNumber}`,
          attachments: [],
          sessionId: existingSessionId,
        }, dashboard);
      } catch (retryErr) {
        // Clear stale session
        if (existingSessionId) {
          try { await redis.del(sessionKey); } catch {}
        }

        // Wait on retryable errors (auth, rate limit)
        const isRetryable = retryErr.retryable || retryErr.message?.includes('Invalid API key') || retryErr.message?.includes('unavailable');
        if (isRetryable) {
          console.log(`[Stream] Auth/rate error on ${repo}#${issueNumber} — waiting 60s`);
          await new Promise(r => setTimeout(r, 60_000));
        } else {
          console.log(`[Stream] Error on ${repo}#${issueNumber}: ${retryErr.message} — retrying fresh`);
        }

        // Retry without session
        response = await agent.process(freshPrompt, {
          userId: 'stream-consumer',
          userName: character.name,
          channelId: channelId || 'stream',
          threadId: `stream-${repo}-${issueNumber}`,
          attachments: [],
          sessionId: null,
        }, dashboard);
      }

      // Save session ID for future iterations
      const newSessionId = response?.sessionId;
      if (newSessionId) {
        try {
          await redis.set(sessionKey, newSessionId, 'EX', 86400 * 7); // 7 day TTL
          console.log(`[Stream] Saved session ${newSessionId} for ${repo}#${issueNumber}`);
        } catch {}
      }

      const responseText = response?.text || response?.toString() || '';
      if (responseText.trim().length > 20 && thread) {
        try { await thread.send(responseText.slice(0, 2000)); } catch {}
      }

      // Extract PR number — prefer github.com URL, then fallback to "PR #N"
      let prNumber = null;
      const urlMatch = responseText.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
      if (urlMatch) {
        prNumber = parseInt(urlMatch[1]);
      } else {
        // Fallback: look for "PR #N" but only with reasonable numbers (>0, <10000)
        const prTextMatch = responseText.match(/(?:created|opened|pushed).*?#(\d+)|pull request #(\d+)/i);
        if (prTextMatch) {
          const n = parseInt(prTextMatch[1] || prTextMatch[2]);
          if (n > 0 && n < 10000) prNumber = n;
        }
      }

      // Complete execution log with full details
      const implementDetail = [
        responseText.slice(0, 300),
        response?.durationMs ? `Duration: ${(response.durationMs/1000).toFixed(1)}s (API: ${(response.durationApiMs/1000).toFixed(1)}s)` : '',
        response?.inputTokens ? `Tokens: ${response.inputTokens} in / ${response.outputTokens} out / ${response.cacheReadTokens} cache-read / ${response.cacheCreationTokens} cache-write` : '',
      ].filter(Boolean).join('\n');
      await logStep('implement', 'completed', implementDetail, response?.costUsd, response?.turns);

      // Send full usage data as log entries
      if (executionLogId && conductorUrl && response?.modelUsage) {
        const logEntries = [];
        for (const [model, usage] of Object.entries(response.modelUsage)) {
          logEntries.push({
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Model ${model}: ${usage.inputTokens || 0} in / ${usage.outputTokens || 0} out, cache ${usage.cacheReadInputTokens || 0} read / ${usage.cacheCreationInputTokens || 0} write, $${(usage.costUSD || 0).toFixed(4)}`,
          });
        }
        if (logEntries.length) {
          try {
            await fetch(`${conductorUrl}/api/execution-logs/${executionLogId}/logs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(logEntries),
            });
          } catch {}
        }
      }

      if (executionLogId && conductorUrl) {
        try {
          await fetch(`${conductorUrl}/api/execution-logs/${executionLogId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'completed',
              totalCostUsd: response?.costUsd || 0,
              totalTurns: response?.turns || 0,
              totalInputTokens: response?.inputTokens || 0,
              totalOutputTokens: response?.outputTokens || 0,
              cacheReadTokens: response?.cacheReadTokens || 0,
              cacheCreationTokens: response?.cacheCreationTokens || 0,
              durationApiMs: response?.durationApiMs || 0,
              prNumber,
            }),
          });
        } catch {}
      }
      // If this is a review agent, trigger merge on approval
      // Events (REVIEW_PASSED/REVIEW_DISPUTED) come from the webhook — no need to post from here
      const isReviewAgent = agentId.includes('review');
      if (isReviewAgent && conductorUrl) {
        const lowerText = responseText.toLowerCase();
        const approved = lowerText.includes('approved') || lowerText.includes('approve');

        if (approved) {
          console.log(`[Stream] Review-E approved ${repo}#${issueNumber} — triggering merge`);
          await fetch(`${conductorUrl}/api/merge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo, prNumber: parseInt(issueNumber) }),
          }).catch(err => console.warn(`[Stream] Merge trigger failed: ${err.message}`));
        } else {
          console.log(`[Stream] Review-E result for ${repo}#${issueNumber}: ${lowerText.includes('changes') ? 'changes requested' : 'unknown'}`);
        }
      }

    } catch (err) {
      console.error(`[Stream] Agent error on ${repo}#${issueNumber}: ${err.message}`);

      // Log failure
      await logStep('implement', 'failed', err.message);
      if (executionLogId && conductorUrl) {
        try {
          await fetch(`${conductorUrl}/api/execution-logs/${executionLogId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'failed' }),
          });
        } catch {}
      }

      delete process.env.CONDUCTOR_REPO;
      delete process.env.CONDUCTOR_ISSUE_NUMBER;

      // Wait before retry to avoid hammering API on auth/rate errors
      const isRetryable = err.retryable || err.message?.includes('Invalid API key') || err.message?.includes('rate limit');
      if (isRetryable) {
        console.log(`[Stream] Retryable error — waiting 60s before retry`);
        await new Promise(r => setTimeout(r, 60_000));
      }

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
