import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import { loadCharacter } from './character.js';
import { createAgent } from './agent.js';
import { createMemory } from './memory.js';
import { createDashboard } from './dashboard/server.js';

const character = loadCharacter();

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

const memory = await createMemory();
const agent = createAgent(character, memory);
const dashboard = createDashboard(character, memory);

client.once('ready', () => {
  console.log(`[Automate-E] Logged in as ${client.user.tag}`);
  console.log(`[Automate-E] Listening on channels: ${character.discord.channels.join(', ')}`);
  console.log(`[Automate-E] DMs: enabled`);
  dashboard.addLog('info', `Logged in as ${client.user.tag}`);
});

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
      await message.channel.sendTyping();
      dashboard.updateSession(`dm-${message.author.id}`, { user: message.author.username, type: 'dm' });

      const response = await agent.process(message.content, {
        userId: message.author.id,
        userName: message.author.displayName || message.author.username,
        channelId: message.channel.id,
        threadId: `dm-${message.author.id}`,
        attachments: [...message.attachments.values()].map(a => ({
          name: a.name, url: a.url, contentType: a.contentType, size: a.size,
        })),
      }, dashboard);

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

      await thread.sendTyping();
      dashboard.updateSession(thread.id, { user: message.author.displayName, type: 'thread' });

      const response = await agent.process(message.content, {
        userId: message.author.id,
        userName: message.author.displayName,
        channelId: message.channel.id,
        threadId: thread.id,
        attachments: [...message.attachments.values()].map(a => ({
          name: a.name, url: a.url, contentType: a.contentType, size: a.size,
        })),
      }, dashboard);

      await thread.send(response);
    }
    dashboard.addLog('info', `Replied to ${message.author.displayName || message.author.username}`);
  } catch (error) {
    console.error('[Automate-E] Error processing message:', error);
    dashboard.addLog('error', `Error: ${error.message}`);
    try {
      await message.reply('Sorry, something went wrong. Please try again.');
    } catch (replyError) {
      console.error('[Automate-E] Failed to send error reply:', replyError);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
