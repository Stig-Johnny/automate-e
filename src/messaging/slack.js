/**
 * Slack messaging adapter.
 * Uses Slack Bolt framework for Socket Mode (no public URL needed).
 *
 * Requires env:
 *   SLACK_BOT_TOKEN - xoxb-... Bot User OAuth Token
 *   SLACK_APP_TOKEN - xapp-... App-Level Token (for Socket Mode)
 *
 * Requires npm packages: @slack/bolt
 */

let App;

async function loadBolt() {
  try {
    const bolt = await import('@slack/bolt');
    App = bolt.default?.App || bolt.App;
  } catch (err) {
    throw new Error(
      'Slack adapter requires @slack/bolt. Install it: npm install @slack/bolt\n' +
      `Original error: ${err.message}`
    );
  }
}

export async function createSlackAdapter(character) {
  await loadBolt();

  const rawChannels = character.messaging?.config?.channels
    || character.slack?.channels
    || character.discord?.channels
    || [];

  const channelList = Array.isArray(rawChannels) ? rawChannels : Object.values(rawChannels);
  const channelNames = channelList.map(c => c.replace(/^#/, ''));

  let messageHandler = null;
  let botUserId = null;

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: 'debug',
  });

  // Register listeners BEFORE app.start() — Bolt requires this
  app.message(async ({ message, say, client }) => {
    console.log(`[Slack] Raw message event: user=${message.user}, channel=${message.channel}, subtype=${message.subtype || 'none'}`);

    if (message.bot_id || message.user === botUserId) return;
    if (message.subtype) return;
    if (!messageHandler) {
      console.log('[Slack] No message handler registered');
      return;
    }

    // Check if message is in an allowed channel
    let channelName;
    try {
      const channelInfo = await client.conversations.info({ channel: message.channel });
      channelName = channelInfo.channel?.name;
    } catch (err) {
      console.log(`[Slack] Can't access channel ${message.channel}: ${err.message}`);
      return;
    }

    console.log(`[Slack] Channel: ${channelName}, allowed: ${channelNames.join(',')}`);
    const isAllowed = channelNames.includes(channelName) || channelNames.includes(message.channel);
    if (!isAllowed) {
      console.log(`[Slack] Channel ${channelName} not in allowed list, ignoring`);
      return;
    }

    let userName = message.user;
    try {
      const userInfo = await client.users.info({ user: message.user });
      userName = userInfo.user?.real_name || userInfo.user?.name || message.user;
    } catch {}

    const threadTs = message.thread_ts || message.ts;

    console.log(`[Slack] Processing message from ${userName} in ${channelName}`);

    await messageHandler({
      content: message.text || '',
      userId: message.user,
      userName,
      channelId: message.channel,
      threadId: `slack-${message.channel}-${threadTs}`,
      attachments: (message.files || []).map(f => ({
        name: f.name,
        url: f.url_private,
        contentType: f.mimetype,
        size: f.size,
      })),
      _slackChannel: message.channel,
      _slackThreadTs: threadTs,
      _say: say,
    });
  });

  app.event('app_mention', async ({ event, say, client }) => {
    console.log(`[Slack] app_mention event: user=${event.user}, channel=${event.channel}`);

    if (!messageHandler) return;

    let userName = event.user;
    try {
      const userInfo = await client.users.info({ user: event.user });
      userName = userInfo.user?.real_name || userInfo.user?.name || event.user;
    } catch {}

    const threadTs = event.thread_ts || event.ts;

    await messageHandler({
      content: event.text || '',
      userId: event.user,
      userName,
      channelId: event.channel,
      threadId: `slack-${event.channel}-${threadTs}`,
      attachments: [],
      _slackChannel: event.channel,
      _slackThreadTs: threadTs,
      _say: say,
    });
  });

  // Catch-all for unhandled events (debug)
  app.event(/.*/, async ({ event }) => {
    console.log(`[Slack] Event received: type=${event.type}`);
  });

  return {
    platform: 'slack',

    async connect() {
      await app.start();
      const authResult = await app.client.auth.test();
      botUserId = authResult.user_id;
      console.log(`[Slack] Connected as ${authResult.user} (${botUserId})`);
      console.log(`[Slack] Listening on channels: ${channelNames.join(', ')}`);
    },

    onMessage(handler) {
      messageHandler = handler;
    },

    async sendReply(context, text) {
      const maxLen = 4000;
      const chunks = [];
      for (let i = 0; i < text.length; i += maxLen) {
        chunks.push(text.slice(i, i + maxLen));
      }
      for (const chunk of chunks) {
        await app.client.chat.postMessage({
          channel: context._slackChannel,
          thread_ts: context._slackThreadTs,
          text: chunk,
        });
      }
    },

    async sendToChannel(channelNameOrId, text) {
      try {
        await app.client.chat.postMessage({
          channel: channelNameOrId.replace(/^#/, ''),
          text,
        });
      } catch (err) {
        console.error(`[Slack] Failed to send to ${channelNameOrId}: ${err.message}`);
      }
    },

    async disconnect() {
      await app.stop();
    },
  };
}
