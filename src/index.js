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
import { describeProviderState, getConfiguredProviders, setActiveProvider } from './agent/provider-state.js';
import { fetchAgentOverview, reportTokenUsage } from './conductor.js';
import { buildHeartbeatSnapshot } from './agent-heartbeat.js';
import fs from 'node:fs';
import path from 'node:path';

const character = loadCharacter();
startTokenRefresh();
let heartbeat = null;

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
heartbeat = startHeartbeat(character, {
  getSnapshot: async () => buildHeartbeatSnapshot(character, {
    discordReady: client.isReady(),
    mcpStatus: mcpClients.serverStatus,
  }),
});

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
let botControlPollingInterval = null;

client.once('ready', () => {
  console.log(`[Automate-E] Logged in as ${client.user.tag}`);
  console.log(`[Automate-E] Listening on channels: ${character.discord.channels.join(', ')}`);
  console.log(`[Automate-E] DMs: enabled`);
  dashboard.addLog('info', `Logged in as ${client.user.tag}`);

  // Try event-driven stream consumer first, fall back to cron polling
  let streamConsumer = null;
  if (process.env.VALKEY_URL) {
    const { createStreamConsumer } = await import('./stream-consumer.js');
    streamConsumer = createStreamConsumer(character, agent, dashboard, client);
    if (streamConsumer) {
      const started = await streamConsumer.start();
      if (started) {
        console.log('[Automate-E] Stream consumer active — cron polling disabled');
        dashboard.addLog('info', 'Stream consumer active');
      } else {
        streamConsumer = null;
      }
    }
  }

  if (!streamConsumer && character.cron?.prompt && character.cron?.channelId) {
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
        // Stage 1: check queue in Node.js before spawning CLI — zero cost on idle
        const conductorBaseUrl = process.env.CONDUCTOR_BASE_URL
          || (character.heartbeat?.url?.replace(/\/api\/events$/, '') ?? null);
        const agentId = process.env.AGENT_ID || character.heartbeat?.agentId;

        if (conductorBaseUrl && agentId) {
          let queueRes;
          try {
            queueRes = await fetch(`${conductorBaseUrl}/api/assignments/next?agentId=${agentId}`);
          } catch (err) {
            console.warn(`[Automate-E] Cron: queue check failed — ${err.message}`);
          }

          if (queueRes?.status === 204) {
            // No assignment — send HEARTBEAT directly, skip CLI entirely
            console.log('[Automate-E] Cron: idle — no assignment, skipping CLI');
            dashboard.addLog('info', 'Cron: idle — no assignment, skipping CLI');
            await fetch(`${conductorBaseUrl}/api/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'HEARTBEAT', agentId, status: 'idle' }),
            }).catch(err => console.warn(`[Automate-E] Cron: heartbeat post failed — ${err.message}`));
            return;
          }
          // 200 with assignment (or queue check failed) — fall through to CLI
        }

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
          // Skip non-work messages (heartbeats, provider info, status)
          if (/^(⏳|Using provider|CLI |Done|idle)/i.test(msg?.trim?.())) return;

          // Only create thread when we detect an actual assignment
          if (!threadCreated) {
            const assignInfo = msg?.match(/ASSIGNMENT:\s*(\S+)#(\d+)\s*[—–-]\s*(.+)/);
            if (!assignInfo) return; // Not an assignment — don't create thread
            threadCreated = true;
            try {
              const label = `🔧 **${character.name}** working on ${assignInfo[1]}#${assignInfo[2]} — ${assignInfo[3].slice(0, 80)}`;
              const threadName = `🔧 ${assignInfo[1]}#${assignInfo[2]} — ${assignInfo[3].slice(0, 40)}`;
              const startMsg = await channel.send(label);
              activeThread = await startMsg.startThread({
                name: threadName,
                autoArchiveDuration: 4320,
              });
              dashboard.addLog('info', `Cron: created work thread — ${threadName}`);
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

        // Extract assignment info for cost tagging
        const assignmentMatch = response?.match(/ASSIGNMENT:\s*(\S+)#(\d+)/);
        if (assignmentMatch) {
          const [, assignedRepo, assignedIssue] = assignmentMatch;
          dashboard.addLog('info', `Cron: assignment detected — ${assignedRepo}#${assignedIssue}`);
          // Set env vars so any further reportTokenUsage calls in this cycle pick up the context
          process.env.CONDUCTOR_REPO = assignedRepo;
          process.env.CONDUCTOR_ISSUE_NUMBER = assignedIssue;
        } else {
          // Clear per-cycle env vars so idle runs aren't misattributed
          delete process.env.CONDUCTOR_REPO;
          delete process.env.CONDUCTOR_ISSUE_NUMBER;
        }

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

  startBotControlPolling().catch(error => {
    console.error('[Automate-E] Bot control polling failed:', error);
    dashboard.addLog('error', `Bot control polling failed: ${error.message}`);
  });
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
  if (message.author.bot && normalizeControlCommand(message.content)) return;

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
      const controlReply = await handleControlCommand(message, message.channel);
      if (controlReply) return;
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

  if (command === 'provider') {
    await replyChannel.send(describeProviderState(character));
    return true;
  }

  if (command === 'status') {
    try {
      const agents = await fetchAgentOverview();
      await replyChannel.send(formatAgentOverviewReport(agents));
    } catch (error) {
      await replyChannel.send(`Could not load Conductor-E agent status: ${error.message}`);
    }
    return true;
  }

  if (command.startsWith('use:')) {
    const provider = command.slice('use:'.length);
    try {
      const selected = setActiveProvider(character, provider);
      await replyChannel.send(`Active provider set to \`${selected}\`. Configured providers: ${getConfiguredProviders(character).join(', ')}.`);
    } catch (error) {
      await replyChannel.send(error.message);
    }
    return true;
  }

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
  if (['/status', 'status', 'agent status'].includes(normalized)) {
    return 'status';
  }
  if (['/provider', 'provider', 'status provider'].includes(normalized)) {
    return 'provider';
  }
  const useMatch = normalized.match(/^\/?use\s+([a-z0-9-]+)$/);
  if (useMatch) {
    return `use:${useMatch[1]}`;
  }
  if (['/abort-login', 'abort login', 'cancel login'].includes(normalized)) {
    return 'abort-login';
  }
  if (['/retry-login', 'retry login', 'reset login'].includes(normalized)) {
    return 'retry-login';
  }
  return null;
}

function formatAgentOverviewReport(agents) {
  if (!Array.isArray(agents) || agents.length === 0) {
    return 'No agents found in Conductor-E.';
  }

  const relevantAgents = agents
    .filter(agent => !String(agent.id || '').includes('#'))
    .filter(agent =>
      agent.isOnline
      || (agent.providers || []).length > 0
      || (agent.integrations || []).length > 0,
    );

  const liveAgents = relevantAgents
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));

  const onlineCount = liveAgents.filter(agent => agent.isOnline).length;
  const degradedCount = liveAgents.filter(agent =>
    (agent.providers || []).some(provider => provider.status !== 'ready' && provider.status !== 'authenticated')
    || (agent.integrations || []).some(integration =>
      !['ready', 'connected', 'configured', 'authenticated'].includes(integration.status)),
  ).length;

  const lines = [
    `Agent overview: ${onlineCount}/${liveAgents.length} online, ${degradedCount} degraded.`,
  ];

  for (const agent of liveAgents) {
    const providerBits = (agent.providers || [])
      .map(provider => `${provider.active ? '*' : ''}${provider.name}:${provider.status}`)
      .join(', ') || 'none';
    const integrationBits = (agent.integrations || [])
      .map(integration => `${integration.name}:${integration.status}`)
      .join(', ') || 'none';
    lines.push(
      `- ${agent.id} | ${agent.isOnline ? 'online' : 'offline'} | active=${agent.activeProvider || 'n/a'} | providers=[${providerBits}] | integrations=[${integrationBits}]`,
    );
  }

  return lines.join('\n').slice(0, 1900);
}

async function startBotControlPolling() {
  if (botControlPollingInterval) return;

  const allowedBots = character.discord?.allowBots || [];
  if (allowedBots.length === 0) return;

  const channelNames = character.discord?.channels || [];
  if (channelNames.length === 0) return;

  const guildChannels = [...client.channels.cache.values()]
    .filter(channel => channel?.isTextBased?.() && channel?.name);

  const targetChannels = guildChannels.filter(channel => channelNames.includes(`#${channel.name}`));
  if (targetChannels.length === 0) return;

  botControlPollingInterval = setInterval(async () => {
    for (const channel of targetChannels) {
      await pollBotControlChannel(channel.id, allowedBots);
    }
  }, 5000);
}

async function pollBotControlChannel(channelId, allowedBots) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  const cursorFile = getBotControlCursorFile(channelId);
  const lastSeenId = readCursor(cursorFile);

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=10`, {
    headers: { Authorization: `Bot ${token}` },
  });

  if (!response.ok) return;

  const messages = await response.json();
  const sorted = [...messages].sort((a, b) => a.id.localeCompare(b.id));

  for (const message of sorted) {
    const messageId = message?.id;
    const authorId = message?.author?.id;
    const isBot = !!message?.author?.bot;
    const content = message?.content;

    if (!messageId || !content) continue;
    if (messageId.localeCompare(lastSeenId) <= 0) continue;

    writeCursor(cursorFile, messageId);
    if (!isBot || !allowedBots.includes(authorId)) continue;

    const control = normalizeControlCommand(content);
    if (!control) continue;

    const replyChannel = await client.channels.fetch(channelId);
    if (!replyChannel?.isTextBased?.()) continue;
    await handleControlCommand({ content }, replyChannel);
  }
}

function getBotControlCursorFile(channelId) {
  const stateRoot = process.env.CODEX_HOME || process.env.HOME || process.cwd();
  return path.join(stateRoot, `automate-e-bot-control-last-${channelId}`);
}

function readCursor(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function writeCursor(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${value}\n`);
}
