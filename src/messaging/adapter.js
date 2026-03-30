/**
 * Messaging adapter interface.
 * All platform adapters (Discord, Slack) implement this contract.
 *
 * The agent loop calls these methods without knowing which platform it's on.
 */

/**
 * Create a messaging adapter based on character config.
 *
 * @param {object} character - Character config with messaging settings
 * @returns {object} Adapter with connect(), onMessage(), sendReply(), sendToChannel()
 */
export function createMessagingAdapter(character) {
  const platform = character.messaging?.platform || 'discord';

  switch (platform) {
    case 'discord':
      // Lazy import to avoid loading discord.js when using Slack
      return import('./discord.js').then(m => m.createDiscordAdapter(character));
    case 'slack':
      return import('./slack.js').then(m => m.createSlackAdapter(character));
    default:
      throw new Error(`Unknown messaging platform: ${platform}. Supported: discord, slack`);
  }
}
