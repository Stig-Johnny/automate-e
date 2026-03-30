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
    || character.discord?.channels // Fallback for backward compat
    || [];

  // Normalize channels — can be array ["#foo"] or object {key: "foo"}
  const channelList = Array.isArray(rawChannels) ? rawChannels : Object.values(rawChannels);

  // Strip # prefix from channel names for matching
  const channelNames = channelList.map(c => c.replace(/^#/, ''));

  let messageHandler = null;

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    // Don't log every event
    logLevel: 'warn',
  });

  // Cache bot user ID to ignore own messages
  let botUserId = null;

  return {
    platform: 'slack',

    async connect() {
      await app.start();
      const authResult = await app.client.auth.test();
      botUserId = authResult.user_id;
      console.log(`[Slack] Connected as ${authResult.user} (${botUserId})`);
      console.log(`[Slack] Listening on channels: ${channels.join(', ')}`);

      // Listen for messages
      app.message(async ({ message, say, client }) => {
        // Ignore bot's own messages
        if (message.bot_id || message.user === botUserId) return;
        // Ignore message subtypes (edits, deletes, etc.)
        if (message.subtype) return;

        if (!messageHandler) return;

        // Check if message is in an allowed channel
        let channelInfo;
        try {
          channelInfo = await client.conversations.info({ channel: message.channel });
        } catch {
          return; // Can't access channel
        }

        const channelName = channelInfo.channel?.name;
        const isThread = !!message.thread_ts;
        const isAllowed = channelNames.includes(channelName) || channelNames.includes(message.channel);

        if (!isAllowed) return;

        // Get user info
        let userName = message.user;
        try {
          const userInfo = await client.users.info({ user: message.user });
          userName = userInfo.user?.real_name || userInfo.user?.name || message.user;
        } catch {}

        // Use thread_ts for threading — reply in thread if already in one,
        // otherwise start a new thread on the message
        const threadTs = message.thread_ts || message.ts;

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
          // Platform-specific context for reply
          _slackChannel: message.channel,
          _slackThreadTs: threadTs,
          _say: say,
        });
      });

      // Listen for app_mention events (when someone @mentions the bot)
      app.event('app_mention', async ({ event, say, client }) => {
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
    },

    onMessage(handler) {
      messageHandler = handler;
    },

    async sendReply(context, text) {
      // Split long messages (Slack limit is 40000 chars but keep it readable)
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
      // Try direct channel ID first
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
