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

  // For guild messages, create/reuse a thread
  let threadId;
  let replyTarget; // channel or thread to send typing indicator and replies to

  if (isDM) {
    threadId = `dm-${message.author.id}`;
    replyTarget = message.channel;
    await message.channel.sendTyping();
  } else {
    const thread = message.hasThread
      ? message.thread
      : await message.startThread({
          name: `${message.author.displayName} — ${new Date().toLocaleDateString('nb-NO')}`,
          autoArchiveDuration: 1440,
        });
    threadId = thread.id;
    replyTarget = thread;
    await thread.sendTyping();
  }

  const payload = {
    messageContent: message.content,
    authorId: message.author.id,
    authorName: message.author.displayName || message.author.username,
    channelId: message.channel.id,
    threadId,
    attachments: [...message.attachments.values()].map(a => ({
      name: a.name, url: a.url, contentType: a.contentType, size: a.size,
    })),
    isDM,
    guildId: message.guild?.id || null,
    // For DM replies, we store the message id so we can reply to it
    messageId: message.id,
  };

  console.log(`[Gateway] Publishing message from ${payload.authorName} (thread: ${threadId})`);

  await redis.xadd(STREAM_MESSAGES, '*',
    'payload', JSON.stringify(payload),
  );
});

// --- Listen for worker replies on Redis stream ---
async function listenForReplies() {
  // Create consumer group if it doesn't exist
  try {
    await redisSub.xgroup('CREATE', STREAM_REPLIES, 'gateway', '0', 'MKSTREAM');
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) throw err;
  }

  const consumerId = `gateway-${process.pid}`;

  while (true) {
    try {
      const results = await redisSub.xreadgroup(
        'GROUP', 'gateway', consumerId,
        'COUNT', 10,
        'BLOCK', 5000,
        'STREAMS', STREAM_REPLIES, '>',
      );

      if (!results) continue;

      for (const [, entries] of results) {
        for (const [id, fields] of entries) {
          try {
            const reply = JSON.parse(fields[1]); // fields = ['payload', '...']
            await deliverReply(reply);
            await redisSub.xack(STREAM_REPLIES, 'gateway', id);
          } catch (err) {
            console.error('[Gateway] Failed to deliver reply:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('[Gateway] Reply listener error:', err.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function deliverReply(reply) {
  const { threadId, content, isDM } = reply;

  if (isDM) {
    // DM thread IDs are dm-{userId}
    const userId = threadId.replace('dm-', '');
    const user = await client.users.fetch(userId);
    const dmChannel = await user.createDM();
    await dmChannel.send(content);
  } else {
    // threadId is a Discord thread/channel ID
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
process.on('SIGTERM', async () => {
  console.log('[Gateway] Shutting down...');
  client.destroy();
  redis.disconnect();
  redisSub.disconnect();
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
