/**
 * Gateway process — connects to Discord, publishes messages to Redis stream.
 * Run one replica only (Discord allows one gateway connection per bot token).
 *
 * Requires: DISCORD_BOT_TOKEN, REDIS_URL, CHARACTER_FILE
 */
import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import Redis from 'ioredis';
import { loadCharacter } from './character.js';
import { createDashboard } from './dashboard/server.js';

const STREAM_MESSAGES = 'automate-e:messages';
const MAX_STREAM_LEN = 10000;
const recentMessageIds = new Set();

const character = loadCharacter();
const dashboard = createDashboard(character);

// --- Redis ---
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('[Gateway] REDIS_URL is required in gateway mode');
  process.exit(1);
}

const redis = new Redis(redisUrl);
redis.on('error', (err) => console.error('[Gateway] Redis error:', err.message));

// Subscribe to worker dashboard events
const redisSub = new Redis(redisUrl);
redisSub.on('error', (err) => console.error('[Gateway] Redis sub error:', err.message));
redisSub.subscribe('automate-e:dashboard');
redisSub.on('message', (channel, message) => {
  try {
    const event = JSON.parse(message);
    if (event.type === 'log') dashboard.addLog(event.data.level, event.data.message);
    if (event.type === 'toolCall') dashboard.addToolCall(event.data.name, event.data.status, event.data.latencyMs);
    if (event.type === 'usage' && dashboard.setWorkerUsage) dashboard.setWorkerUsage(event.data);
  } catch {}
});

// --- Discord client ---
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

client.once('ready', () => {
  console.log(`[Gateway] Logged in as ${client.user.tag}`);
  console.log(`[Gateway] Listening on channels: ${character.discord.channels.join(', ')}`);
  dashboard.addLog('info', `Logged in as ${client.user.tag}`);
});

// --- Publish incoming messages to Redis stream ---
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

  // Deduplicate — skip if we already published this message
  if (recentMessageIds.has(message.id)) return;
  recentMessageIds.add(message.id);
  if (recentMessageIds.size > 100) {
    const first = recentMessageIds.values().next().value;
    recentMessageIds.delete(first);
  }

  let threadId;
  const displayName = message.member?.displayName || message.author.displayName || message.author.username;

  if (isDM) {
    threadId = `dm-${message.author.id}`;
    await message.channel.sendTyping();
  } else {
    let thread;
    if (message.hasThread) {
      thread = message.thread;
    } else {
      try {
        thread = await message.startThread({
          name: `${displayName} — ${new Date().toLocaleDateString('en-US')}`,
          autoArchiveDuration: 1440,
        });
      } catch (err) {
        if (err.code === 160004) {
          thread = await message.fetch().then(m => m.thread);
        } else {
          throw err;
        }
      }
    }
    threadId = thread.id;
    await thread.sendTyping();
  }

  const payload = {
    messageContent: message.content,
    authorId: message.author.id,
    authorName: displayName,
    channelId: message.channel.id,
    threadId,
    attachments: [...message.attachments.values()].map(a => ({
      name: a.name, url: a.url, contentType: a.contentType, size: a.size,
    })),
    isDM,
    guildId: message.guild?.id || null,
    messageId: message.id,
  };

  console.log(`[Gateway] Publishing message from ${payload.authorName} (thread: ${threadId})`);
  dashboard.addLog('info', `Message from ${payload.authorName}: ${payload.messageContent.slice(0, 80)}`);
  dashboard.updateSession(threadId, { user: payload.authorName, type: isDM ? 'dm' : 'thread' });

  await redis.xadd(STREAM_MESSAGES, 'MAXLEN', '~', MAX_STREAM_LEN, '*',
    'payload', JSON.stringify(payload),
  );
});

// --- Graceful shutdown ---
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Gateway] ${signal} received, shutting down...`);
    client.destroy();
    redis.disconnect();
    redisSub.disconnect();
    process.exit(0);
  });
}

client.login(process.env.DISCORD_BOT_TOKEN);
