import { readFileSync } from 'fs';

const REQUIRED_FIELDS = ['name', 'personality', 'tools', 'llm'];

export function loadCharacter() {
  const charPath = process.env.CHARACTER_FILE || '/config/character.json';

  let raw;
  try {
    raw = readFileSync(charPath, 'utf-8');
  } catch (e) {
    console.error(`[Automate-E] Failed to load character file at ${charPath}: ${e.message}`);
    console.error('[Automate-E] Set CHARACTER_FILE env var or mount a character.json at /config/character.json');
    process.exit(1);
  }

  let character;
  try {
    character = JSON.parse(raw);
  } catch (e) {
    console.error(`[Automate-E] Failed to parse character file at ${charPath}: ${e.message}`);
    process.exit(1);
  }

  for (const field of REQUIRED_FIELDS) {
    if (!character[field]) {
      console.error(`[Automate-E] Character file missing required field: ${field}`);
      process.exit(1);
    }
  }

  // Validate messaging — support both legacy discord field and new messaging field
  if (character.messaging) {
    // New-style: messaging.platform + messaging.config
    if (!['discord', 'slack'].includes(character.messaging.platform)) {
      console.error(`[Automate-E] Invalid config: messaging.platform must be 'discord' or 'slack', got '${character.messaging.platform}'.`);
      process.exit(1);
    }
    // Populate discord field from messaging config for backward compat
    if (character.messaging.platform === 'discord' && !character.discord) {
      character.discord = {
        channels: Object.values(character.messaging.config?.channels || {}),
      };
    }
  } else if (!character.discord || !Array.isArray(character.discord.channels)) {
    console.error('[Automate-E] Invalid config: either messaging.platform or discord.channels is required.');
    process.exit(1);
  }

  // Set default messaging from discord config if not specified
  if (!character.messaging && character.discord) {
    character.messaging = {
      platform: 'discord',
      config: { channels: character.discord.channels },
    };
  }
  if (!character.llm?.model) {
    console.error('[Automate-E] Invalid config: llm.model is required.');
    process.exit(1);
  }
  if (!Array.isArray(character.tools)) {
    console.error('[Automate-E] Invalid config: tools must be an array.');
    process.exit(1);
  }

  // Apply defaults for optional fields
  character.lore = character.lore || [];
  character.style = character.style || { language: 'English', tone: 'helpful', format: 'concise' };
  character.memory = character.memory || { conversationRetention: '30d' };
  character.llm.provider = character.llm.provider || 'anthropic';
  character.llm.temperature = character.llm.temperature ?? 0.3;
  if (character.discord) {
    character.discord.allowBots = character.discord.allowBots || [];
  }
  character.mcpServers = character.mcpServers || {};
  character.cron = character.cron || null;
  character.webhooks = character.webhooks || {};
  character.heartbeat = character.heartbeat || null;

  console.log(`[Automate-E] Loaded character: ${character.name}`);
  return character;
}
