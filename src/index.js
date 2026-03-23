import { Client, GatewayIntentBits, Partials } from 'discord.js';
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
  ],
  partials: [Partials.Message, Partials.Channel],
});

const memory = await createMemory();
const agent = createAgent(character, memory);

client.once('ready', () => {
  console.log(`[Automate-E] Logged in as ${client.user.tag}`);
  console.log(`[Automate-E] Listening on channels: ${character.discord.channels.join(', ')}`);
});

client.on('messageCreate', async (message) => {
  // Ignore own messages and other bots
  if (message.author.bot) return;

  // Only respond in configured channels (including threads whose parent is configured)
  const baseChannel = message.channel.isThread?.() ? message.channel.parent : message.channel;
  if (!baseChannel) return;
  const channelName = `#${baseChannel.name}`;
  if (!character.discord.channels.includes(channelName)) return;

  try {
    // Create or find thread for this message
    const thread = message.hasThread
      ? message.thread
      : await message.startThread({
          name: `${message.author.displayName} — ${new Date().toLocaleDateString('nb-NO')}`,
          autoArchiveDuration: 1440, // 24 hours
        });

    // Show typing indicator
    await thread.sendTyping();

    // Process with agent
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

    // Reply in thread
    await thread.send(response);
  } catch (error) {
    console.error('[Automate-E] Error processing message:', error);
    try {
      const thread = message.thread || await message.startThread({ name: 'Error' });
      await thread.send('Beklager, noe gikk galt. Prøv igjen.');
    } catch (replyError) {
      console.error('[Automate-E] Failed to send error reply:', replyError);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
