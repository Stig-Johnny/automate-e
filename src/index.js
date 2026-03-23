import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import { loadCharacter } from './character.js';
import { createAgent } from './agent.js';
import { createMemory } from './memory.js';

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

client.once('ready', () => {
  console.log(`[Automate-E] Logged in as ${client.user.tag}`);
  console.log(`[Automate-E] Listening on channels: ${character.discord.channels.join(', ')}`);
  console.log(`[Automate-E] DMs: enabled`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isDM = message.channel.type === ChannelType.DM;

  if (!isDM) {
    // Guild message — only respond in configured channels (including threads)
    const baseChannel = message.channel.isThread?.() ? message.channel.parent : message.channel;
    if (!baseChannel) return;
    const channelName = `#${baseChannel.name}`;
    if (!character.discord.channels.includes(channelName)) return;
  }

  try {
    if (isDM) {
      // DMs: reply directly (no threads in DMs)
      await message.channel.sendTyping();

      const response = await agent.process(message.content, {
        userId: message.author.id,
        userName: message.author.displayName || message.author.username,
        channelId: message.channel.id,
        threadId: `dm-${message.author.id}`,
        attachments: [...message.attachments.values()].map(a => ({
          name: a.name,
          url: a.url,
          contentType: a.contentType,
          size: a.size,
        })),
      });

      await message.reply(response);
    } else {
      // Guild: create thread per document
      const thread = message.hasThread
        ? message.thread
        : await message.startThread({
            name: `${message.author.displayName} — ${new Date().toLocaleDateString('nb-NO')}`,
            autoArchiveDuration: 1440,
          });

      await thread.sendTyping();

      const response = await agent.process(message.content, {
        userId: message.author.id,
        userName: message.author.displayName,
        channelId: message.channel.id,
        threadId: thread.id,
        attachments: [...message.attachments.values()].map(a => ({
          name: a.name,
          url: a.url,
          contentType: a.contentType,
          size: a.size,
        })),
      });

      await thread.send(response);
    }
  } catch (error) {
    console.error('[Automate-E] Error processing message:', error);
    try {
      await message.reply('Beklager, noe gikk galt. Prøv igjen.');
    } catch (replyError) {
      console.error('[Automate-E] Failed to send error reply:', replyError);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
