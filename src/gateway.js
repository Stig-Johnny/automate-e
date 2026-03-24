/**
 * Gateway process — connects to Discord, publishes messages to Redis stream.
 * Run one replica only (Discord allows one gateway connection per bot token).
 *
 * Requires: DISCORD_BOT_TOKEN, REDIS_URL, CHARACTER_FILE
 */
import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import Redis from 'ioredis';
import { loadCharacter } from './character.js';

const STREAM_MESSAGES = 'automate-e:messages';
const STREAM_REPLIES = 'automate-e:replies';
const MAX_STREAM_LEN = 10000;

const character = loadCharacter();

// --- Redis ---
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('[Gateway] REDIS_URL is required in gateway mode');
  process.exit(1);
}

const redis = new Redis(redisUrl);
const redisSub = new Redis(redisUrl);

redis.on('error', (err) => console.error('[Gateway] Redis error:', err.message));
redisSub.on('error', (err) => console.error('[Gateway] Redis sub error:', err.message));

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
  listenForReplies();
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

  let threadId;
  const displayName = message.member?.displayName || message.author.displayName || message.author.username;

  if (isDM) {
    threadId = `dm-${message.author.id}`;
    await message.channel.sendTyping();
  } else {
    const thread = message.hasThread
      ? message.thread
      : await message.startThread({
          name: `${displayName} — ${new Date().toLocaleDateString('nb-NO')}`,
          autoArchiveDuration: 1440,
        });
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

  await redis.xadd(STREAM_MESSAGES, 'MAXLEN', '~', MAX_STREAM_LEN, '*',
    'payload', JSON.stringify(payload),
  );
});

// --- Listen for worker replies on Redis stream ---
async function listenForReplies() {
  try {
    await redisSub.xgroup('CREATE', STREAM_REPLIES, 'gateway', '$', 'MKSTREAM');
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) throw err;
  }

  const consumerId = `gateway-${process.pid}`;

  async function pollReplies() {
    try {
      const results = await redisSub.xreadgroup(
        'GROUP', 'gateway', consumerId,
        'COUNT', 10,
        'BLOCK', 2000,
        'STREAMS', STREAM_REPLIES, '>',
      );

      if (results) {
        for (const [, entries] of results) {
          for (const [id, fields] of entries) {
            try {
              const reply = JSON.parse(fields[1]);
              await deliverReply(reply);
            } catch (err) {
              console.error('[Gateway] Failed to deliver reply:', err.message);
            }
            await redisSub.xack(STREAM_REPLIES, 'gateway', id);
          }
        }
      }
    } catch (err) {
      console.error('[Gateway] Reply listener error:', err.message);
    }
    // Yield to event loop, then poll again
    setTimeout(pollReplies, 100);
  }

  pollReplies();
}

async function deliverReply(reply) {
  const { threadId, content, isDM } = reply;

  if (isDM) {
    const userId = threadId.replace('dm-', '');
    const user = await client.users.fetch(userId);
    const dmChannel = await user.createDM();
    await dmChannel.send(content);
  } else {
    const channel = await client.channels.fetch(threadId);
    if (channel) {
      await channel.send(content);
    } else {
      console.error(`[Gateway] Could not find channel ${threadId}`);
    }
  }

  console.log(`[Gateway] Delivered reply to ${threadId}`);
}

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
