/**
 * Discord messaging adapter.
 * Extracted from index.js — same behavior, adapter interface.
 */
import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';

export function createDiscordAdapter(character) {
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

  const channels = character.discord?.channels || character.messaging?.config?.channels || [];
  const allowedBots = character.discord?.allowBots || [];
  let messageHandler = null;

  return {
    platform: 'discord',

    async connect() {
      return new Promise((resolve, reject) => {
        client.once('ready', () => {
          console.log(`[Discord] Logged in as ${client.user.tag}`);
          console.log(`[Discord] Listening on channels: ${channels.join(', ')}`);
          resolve();
        });
        client.once('error', reject);

        client.on('messageCreate', async (message) => {
          if (message.author.id === client.user.id) return;
          if (message.author.bot && !allowedBots.includes(message.author.id)) return;

          const isDM = message.channel.type === ChannelType.DM;

          if (!isDM) {
            const baseChannel = message.channel.isThread?.() ? message.channel.parent : message.channel;
            if (!baseChannel) return;
            const channelName = `#${baseChannel.name}`;
            if (!channels.includes(channelName)) return;
          }

          if (!messageHandler) return;

          // Create or get thread
          let threadId;
          let replyTarget;

          if (isDM) {
            threadId = `dm-${message.author.id}`;
            replyTarget = message.channel;
            await message.channel.sendTyping();
          } else {
            let thread;
            if (message.hasThread) {
              thread = message.thread;
            } else {
              try {
                const displayName = message.member?.displayName || message.author.displayName || message.author.username;
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
            replyTarget = thread;
            await thread.sendTyping();
          }

          const displayName = message.member?.displayName || message.author.displayName || message.author.username;

          await messageHandler({
            content: message.content,
            userId: message.author.id,
            userName: displayName,
            channelId: message.channel.id,
            threadId,
            attachments: [...message.attachments.values()].map(a => ({
              name: a.name, url: a.url, contentType: a.contentType, size: a.size,
            })),
            // Platform-specific reply function
            _replyTarget: replyTarget,
            _isDM: isDM,
          });
        });

        client.login(process.env.DISCORD_BOT_TOKEN);
      });
    },

    onMessage(handler) {
      messageHandler = handler;
    },

    async sendReply(context, text) {
      if (text.length > 2000) {
        // Discord has a 2000 char limit — split into chunks
        const chunks = [];
        for (let i = 0; i < text.length; i += 2000) {
          chunks.push(text.slice(i, i + 2000));
        }
        for (const chunk of chunks) {
          if (context._isDM) {
            await context._replyTarget.send(chunk);
          } else {
            await context._replyTarget.send(chunk);
          }
        }
      } else {
        await context._replyTarget.send(text);
      }
    },

    async sendToChannel(channelNameOrId, text) {
      // Try by ID first, then by name
      let channel = client.channels.cache.get(channelNameOrId);
      if (!channel) {
        // Search by name (strip # prefix)
        const name = channelNameOrId.replace(/^#/, '');
        channel = client.channels.cache.find(c => c.name === name);
      }
      if (!channel) {
        console.error(`[Discord] Channel not found: ${channelNameOrId}`);
        return;
      }
      await channel.send(text.slice(0, 2000));
    },

    async disconnect() {
      client.destroy();
    },
  };
}
