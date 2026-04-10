/**
 * Automate-E v2 — Single-process mode with messaging adapter.
 *
 * Supports Discord and Slack via character.messaging.platform config.
 * Falls back to Discord for backward compatibility.
 */
import { loadCharacter } from './character.js';
import { createAgent } from './agent.js';
import { createMemory } from './memory.js';
import { createDashboard } from './dashboard/server.js';
import { connectMcpServers } from './mcp.js';
import { createMessagingAdapter } from './messaging/adapter.js';
import { createWebhookHandler } from './webhook.js';

const character = loadCharacter();

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[Automate-E] WARNING: ANTHROPIC_API_KEY not set — API calls will fail');
}

const memory = await createMemory();
const mcpClients = await connectMcpServers(character.mcpServers);
const agent = createAgent(character, memory, mcpClients);

// Webhook handler
const webhookHandler = Object.keys(character.webhooks || {}).length > 0
  ? createWebhookHandler(character, {
      processDirectly: async (payload) => {
        const response = await agent.process(payload.messageContent, {
          userId: payload.authorId,
          userName: payload.authorName,
          channelId: payload.channelId,
          threadId: payload.threadId,
          attachments: [],
        }, dashboard);

        // Post response via messaging adapter if channel is configured
        if (response.trim() && messaging) {
          const targetChannel = character.messaging?.config?.webhookResponseChannel
            || character.discord?.channels?.[0];
          if (targetChannel) {
            await messaging.sendToChannel(targetChannel, response.slice(0, 2000));
          }
        }
      },
    })
  : null;

const dashboard = createDashboard(character, memory, { webhookHandler });
if (mcpClients.serverStatus) dashboard.setMcpStatus(mcpClients.serverStatus);

// Create messaging adapter (Discord or Slack based on character config)
const messaging = await createMessagingAdapter(character);

// Register message handler
messaging.onMessage(async (msg) => {
  dashboard.addLog('info', `Message from ${msg.userName}: ${msg.content.slice(0, 80)}`);
  dashboard.updateSession(msg.threadId, { user: msg.userName, type: 'message' });

  try {
    const progress = async (text) => {
      await messaging.sendReply(msg, text);
    };

    const response = await agent.process(msg.content, {
      userId: msg.userId,
      userName: msg.userName,
      channelId: msg.channelId,
      threadId: msg.threadId,
      attachments: msg.attachments || [],
    }, dashboard, progress);

    await messaging.sendReply(msg, response);
    dashboard.addLog('info', `Replied to ${msg.userName}`);
  } catch (error) {
    console.error('[Automate-E] Error processing message:', error);
    dashboard.addLog('error', `Error: ${error.message}`);
    try {
      await messaging.sendReply(msg, 'Sorry, something went wrong. Please try again.');
    } catch (replyError) {
      console.error('[Automate-E] Failed to send error reply:', replyError);
    }
  }
});

// Connect to messaging platform
await messaging.connect();
console.log(`[Automate-E] ${character.name} running on ${messaging.platform}`);

// Graceful shutdown
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Automate-E] ${signal} received, shutting down...`);
    await messaging.disconnect();
    process.exit(0);
  });
}
