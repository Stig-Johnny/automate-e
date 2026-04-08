import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import { loadCharacter } from './character.js';
import { createAgent } from './agent.js';
import { createMemory } from './memory.js';
import { createDashboard } from './dashboard/server.js';
import { connectMcpServers } from './mcp.js';
import { createWebhookHandler } from './webhook.js';
import { startHeartbeat } from './heartbeat.js';
import { startTokenRefresh } from './github-token.js';
import { abortDeviceAuthFlow, resetDeviceAuthCooldown } from './agent/providers/codex-auth.js';

const character = loadCharacter();
startTokenRefresh();
const heartbeat = startHeartbeat(character);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel],
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[Automate-E] WARNING: ANTHROPIC_API_KEY not set — API calls will fail');
}

const memory = await createMemory();
const mcpClients = await connectMcpServers(character.mcpServers);
const agent = createAgent(character, memory, mcpClients);

// Webhook handler for single-process mode
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
        // Post to Discord webhook if configured
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (webhookUrl && response.trim()) {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: character.name, content: response.slice(0, 2000) }),
          });
        }
      },
    })
  : null;

const dashboard = createDashboard(character, memory, { webhookHandler });
if (mcpClients.serverStatus) dashboard.setMcpStatus(mcpClients.serverStatus);

client.once('ready', () => {
  console.log(`[Automate-E] Logged in as ${client.user.tag}`);
  console.log(`[Automate-E] Listening on channels: ${character.discord.channels.join(', ')}`);
  console.log(`[Automate-E] DMs: enabled`);
  dashboard.addLog('info', `Logged in as ${client.user.tag}`);

  // In-process cron: poll on a schedule and post results to a channel thread
  if (character.cron?.prompt && character.cron?.channelId) {
    const intervalMs = parseCronInterval(character.cron.schedule) || 300_000;
    console.log(`[Automate-E] Cron enabled: every ${intervalMs / 1000}s → #${character.cron.channelId}`);
    dashboard.addLog('info', `Cron: every ${intervalMs / 1000}s`);

    let cronRunning = false;
    const runCron = async () => {
      if (cronRunning) {
        console.log('[Automate-E] Cron skipped: previous run still active');
        dashboard.addLog('info', 'Cron: skipped (busy)');
        return;
      }
      cronRunning = true;
      try {
        const channel = await client.channels.fetch(character.cron.channelId);
        if (!channel) {
          console.error(`[Automate-E] Cron channel ${character.cron.channelId} not found`);
          return;
        }

        dashboard.addLog('info', 'Cron: running work loop');

        // Track the active thread for progress updates
        let activeThread = null;
        let threadCreated = false;
        let lastProgressTime = 0;
        let progressCount = 0;
        const PROGRESS_THROTTLE_MS = 15_000; // max 1 update per 15s

        const onProgress = async (msg) => {
          progressCount++;
          // Create thread on first tool call (means we got an assignment)
          if (!threadCreated && progressCount === 1) {
            threadCreated = true;
            try {
              const startMsg = await channel.send(`🔧 **${character.name}** picked up work — implementing...`);
              activeThread = await startMsg.startThread({
                name: `🔧 ${character.name} — ${new Date().toISOString().slice(0, 16)}`,
                autoArchiveDuration: 4320,
              });
              dashboard.addLog('info', 'Cron: created work thread');
            } catch (err) {
              console.error(`[Automate-E] Failed to create thread: ${err.message}`);
            }
          }
          if (!activeThread) return;
          const now = Date.now();
          if (now - lastProgressTime < PROGRESS_THROTTLE_MS) return;
          lastProgressTime = now;
          try {
            await activeThread.send(msg);
          } catch (err) {
            console.error(`[Automate-E] Failed to post progress: ${err.message}`);
          }
        };

        const response = await agent.process(character.cron.prompt, {
          userId: client.user.id,
          userName: character.name,
          channelId: character.cron.channelId,
          threadId: `cron-${character.name}`,
          attachments: [],
        }, dashboard, onProgress);

        // Only post meaningful responses to Discord (skip idle/empty/generic)
        const isIdle = !response || response.trim().length < 20
          || /^(CLI |Done|idle|no work|no assignment)/i.test(response.trim());

        if (response && response.trim() && !isIdle) {
          if (activeThread) {
            await activeThread.send(response.slice(0, 2000));
            dashboard.addLog('info', `Cron: posted result to thread`);
          } else {
            await channel.send(response.slice(0, 2000));
            dashboard.addLog('info', `Cron: posted to #${channel.name}`);
          }
        }
      } catch (error) {
        console.error('[Automate-E] Cron error:', error.message);
        dashboard.addLog('error', `Cron: ${error.message}`);
      } finally {
        cronRunning = false;
      }
    };

    // First run after a short delay, then on interval
    setTimeout(runCron, 15_000);
    setInterval(runCron, intervalMs);
  }
});

// Parse cron schedule shorthand: "*/5 * * * *" → 300000ms
function parseCronInterval(schedule) {
  if (!schedule) return null;
  const match = schedule.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*/);
  if (match) return parseInt(match[1]) * 60 * 1000;
  return null;
}

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  const allowedBots = character.discord?.allowBots || [];
  if (message.author.bot && !allowedBots.includes(message.author.id)) return;

  const isDM = message.channel.type === ChannelType.DM;

  if (!isDM) {
    const baseChannel = message.channel.isThread?.() ? message.channel.parent : message.channel;
    if (!baseChannel) return;
    const channelName = `#${baseChannel.name}`;
    if (!character.discord.channels.includes(channelName)) return;
  }

  const threadId = isDM ? `dm-${message.author.id}` : null;
  dashboard.addLog('info', `Message from ${message.author.displayName || message.author.username}: ${message.content.slice(0, 80)}`);

  try {
    if (isDM) {
      const controlReply = await handleControlCommand(message, message.channel);
      if (controlReply) return;
      await message.channel.sendTyping();
      dashboard.updateSession(`dm-${message.author.id}`, { user: message.author.username, type: 'dm' });
      const progress = async (text) => {
        await message.channel.send(text.slice(0, 2000));
      };

      const response = await agent.process(message.content, {
        userId: message.author.id,
        userName: message.author.displayName || message.author.username,
        channelId: message.channel.id,
        threadId: `dm-${message.author.id}`,
        attachments: [...message.attachments.values()].map(a => ({
          name: a.name, url: a.url, contentType: a.contentType, size: a.size,
        })),
      }, dashboard, progress);

      await message.reply(response);
    } else {
      let thread;
      if (message.hasThread) {
        thread = message.thread;
      } else {
        try {
          thread = await message.startThread({
            name: `${message.author.displayName} — ${new Date().toLocaleDateString('en-US')}`,
            autoArchiveDuration: 1440,
          });
        } catch (err) {
          if (err.code === 160004) {
            // Thread already exists for this message — fetch it
            thread = await message.fetch().then(m => m.thread);
          } else {
            throw err;
          }
        }
      }

      const controlReply = await handleControlCommand(message, thread);
      if (controlReply) return;
      await thread.sendTyping();
      dashboard.updateSession(thread.id, { user: message.author.displayName, type: 'thread' });
      const progress = async (text) => {
        await thread.send(text.slice(0, 2000));
      };

      const response = await agent.process(message.content, {
        userId: message.author.id,
        userName: message.author.displayName,
        channelId: message.channel.id,
        threadId: thread.id,
        attachments: [...message.attachments.values()].map(a => ({
          name: a.name, url: a.url, contentType: a.contentType, size: a.size,
        })),
      }, dashboard, progress);

      await thread.send(response);
    }
    dashboard.addLog('info', `Replied to ${message.author.displayName || message.author.username}`);
  } catch (error) {
    console.error('[Automate-E] Error processing message:', error);
    dashboard.addLog('error', `Error: ${error.message}`);
    try {
      await message.reply(error.userMessage || 'Sorry, something went wrong. Please try again.');
    } catch (replyError) {
      console.error('[Automate-E] Failed to send error reply:', replyError);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);

async function handleControlCommand(message, replyChannel) {
  const command = normalizeControlCommand(message.content);
  if (!command) return false;

  if (command === 'abort-login') {
    const aborted = abortDeviceAuthFlow();
    await replyChannel.send(
      aborted
        ? 'Codex login flow aborted. Send `/retry-login` or another message when you want a fresh login link and code.'
        : 'No Codex login flow is currently running.',
    );
    return true;
  }

  if (command === 'retry-login') {
    const aborted = abortDeviceAuthFlow();
    resetDeviceAuthCooldown();
    await replyChannel.send(
      aborted
        ? 'Codex login flow reset. Send your next message now and I will start a fresh login flow.'
        : 'Codex login cooldown cleared. Send your next message now and I will start a fresh login flow.',
    );
    return true;
  }

  return false;
}

function normalizeControlCommand(content) {
  const normalized = content.trim().toLowerCase();
  if (['/abort-login', 'abort login', 'cancel login'].includes(normalized)) {
    return 'abort-login';
  }
  if (['/retry-login', 'retry login', 'reset login'].includes(normalized)) {
    return 'retry-login';
  }
  return null;
}
