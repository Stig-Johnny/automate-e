export function resolveAgentProvider(character) {
  const configuredProvider = character.llm?.provider || 'anthropic';

  if (process.env.CODEX_CLI_MODE === 'true') return 'codex-cli';
  if (process.env.CLAUDE_CLI_MODE === 'true') return 'claude-cli';
  if (configuredProvider === 'openai-api') return 'openai-api';

  if (configuredProvider === 'codex-cli') return 'codex-cli';
  if (configuredProvider === 'claude-cli') return 'claude-cli';

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
  if (anthropicApiKey.startsWith('sk-ant-oat')) return 'claude-cli';

  return 'anthropic';
}
