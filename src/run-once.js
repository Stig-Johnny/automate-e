/**
 * One-shot mode — run a single prompt and exit.
 * Designed for Kubernetes CronJobs (e.g., ATL-E polling PRs every 5 min).
 *
 * Requires: ANTHROPIC_API_KEY, CHARACTER_FILE
 * Optional: DISCORD_WEBHOOK_URL (to post results), DATABASE_URL
 *
 * The prompt is read from character.cron.prompt.
 * Results are posted to the Discord webhook if configured.
 */
import { loadCharacter } from './character.js';
import { createAgent } from './agent.js';
import { createMemory } from './memory.js';
import { connectMcpServers } from './mcp.js';
import { getUsageSummary } from './usage.js';
import { startTokenRefresh } from './github-token.js';

const character = loadCharacter();
startTokenRefresh();

if (!character.cron?.prompt) {
  console.error('[Automate-E] One-shot mode requires character.cron.prompt');
  process.exit(1);
}

const webhookUrl = process.env.DISCORD_WEBHOOK_URL || character.cron.discordWebhookUrl;

console.log(`[Automate-E] One-shot mode: ${character.name}`);

const memory = await createMemory();
const mcpClients = await connectMcpServers(character.mcpServers);
const agent = createAgent(character, memory, mcpClients);

// Minimal dashboard stub for logging
const dashboard = {
  addLog(level, message) { console.log(`[${level}] ${message}`); },
  addToolCall(name, status, latencyMs) { console.log(`[tool] ${name} ${status} (${latencyMs}ms)`); },
  updateSession() {},
  updateUsage() {},
};

try {
  const response = await agent.process(character.cron.prompt, {
    userId: 'cron',
    userName: character.name,
    channelId: 'cron',
    threadId: 'cron',
    attachments: [],
  }, dashboard);

  console.log(`[Automate-E] Response:\n${response}`);

  // Post to Discord webhook if configured
  if (webhookUrl && response.trim()) {
    // Split into 2000-char chunks (Discord limit)
    const chunks = [];
    for (let i = 0; i < response.length; i += 2000) {
      chunks.push(response.slice(i, i + 2000));
    }

    for (const chunk of chunks) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: character.name,
          content: chunk,
        }),
      });
      if (!res.ok) {
        console.error(`[Automate-E] Discord webhook failed: ${res.status} ${await res.text()}`);
      }
    }
    console.log(`[Automate-E] Posted to Discord webhook`);
  }

  console.log(`[Automate-E] ${getUsageSummary()}`);
} catch (error) {
  console.error(`[Automate-E] Fatal: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mcpClients.close();
  await memory.close?.();
}
