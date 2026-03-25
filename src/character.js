import { readFileSync } from 'fs';

const REQUIRED_FIELDS = ['name', 'personality', 'discord', 'tools', 'llm'];

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

  // Validate nested structure
  if (!Array.isArray(character.discord?.channels)) {
    console.error('[Automate-E] Invalid config: discord.channels must be an array of strings.');
    process.exit(1);
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
  character.llm.temperature = character.llm.temperature ?? 0.3;
  character.discord.allowBots = character.discord.allowBots || [];
  character.mcpServers = character.mcpServers || {};
  character.cron = character.cron || null;

  console.log(`[Automate-E] Loaded character: ${character.name}`);
  return character;
}
