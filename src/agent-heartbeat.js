import { getConfiguredProviders, getActiveProvider } from './agent/provider-state.js';
import { getCodexAuthenticationState } from './agent/providers/codex-auth.js';

export async function buildHeartbeatSnapshot(character, options = {}) {
  const configuredProviders = getConfiguredProviders(character);
  const activeProvider = getActiveProvider(character);
  const mcpStatus = options.mcpStatus || {};

  return {
    activeProvider,
    availableProviders: configuredProviders,
    providers: await Promise.all(configuredProviders.map(provider =>
      describeProvider(provider, character, activeProvider))),
    integrations: [
      describeDiscordIntegration(options.discordReady),
      describeConductorIntegration(character),
      ...describeMcpIntegrations(mcpStatus),
      ...describeWebhookIntegrations(character),
      describeGithubIntegration(),
    ].filter(Boolean),
  };
}

async function describeProvider(provider, character, activeProvider) {
  switch (provider) {
    case 'codex-cli': {
      const auth = await getCodexAuthenticationState(character);
      return {
        name: provider,
        status: auth.status,
        details: auth.details,
        active: provider === activeProvider,
      };
    }
    case 'claude-cli': {
      const hasOauth = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
      return {
        name: provider,
        status: hasOauth || hasApiKey ? 'ready' : 'missing_auth',
        details: hasOauth
          ? 'using Claude Code OAuth token'
          : hasApiKey
            ? 'using Anthropic API key'
            : 'CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY is not configured',
        active: provider === activeProvider,
      };
    }
    case 'openai-api':
      return {
        name: provider,
        status: process.env.OPENAI_API_KEY ? 'ready' : 'missing_auth',
        details: process.env.OPENAI_API_KEY ? 'using OPENAI_API_KEY' : 'OPENAI_API_KEY is not configured',
        active: provider === activeProvider,
      };
    case 'anthropic':
    case 'anthropic-sdk':
      return {
        name: provider,
        status: process.env.ANTHROPIC_API_KEY ? 'ready' : 'missing_auth',
        details: process.env.ANTHROPIC_API_KEY ? 'using ANTHROPIC_API_KEY' : 'ANTHROPIC_API_KEY is not configured',
        active: provider === activeProvider,
      };
    default:
      return {
        name: provider,
        status: 'unknown',
        details: 'provider health not implemented',
        active: provider === activeProvider,
      };
  }
}

function describeDiscordIntegration(discordReady) {
  return {
    name: 'discord',
    status: discordReady ? 'ready' : 'degraded',
    details: discordReady ? 'bot is connected' : 'bot is not connected',
  };
}

function describeConductorIntegration(character) {
  const url = character.heartbeat?.url || process.env.CONDUCTOR_BASE_URL;
  return {
    name: 'conductor',
    status: url ? 'configured' : 'missing_config',
    details: url || 'heartbeat url is not configured',
  };
}

function describeMcpIntegrations(serverStatus) {
  return Object.entries(serverStatus).map(([name, info]) => ({
    name: `mcp:${name}`,
    status: info?.status || 'unknown',
    details: typeof info?.toolCount === 'number' ? `${info.toolCount} tools` : null,
  }));
}

function describeWebhookIntegrations(character) {
  const entries = [];
  if (process.env.DISCORD_WEBHOOK_URL) {
    entries.push({
      name: 'discord-webhook',
      status: 'configured',
      details: 'DISCORD_WEBHOOK_URL is configured',
    });
  }

  if (Object.keys(character.webhooks || {}).length > 0) {
    entries.push({
      name: 'webhooks',
      status: 'configured',
      details: `${Object.keys(character.webhooks || {}).length} webhook route(s) configured`,
    });
  }

  return entries;
}

function describeGithubIntegration() {
  const hasApp = !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
  const hasToken = !!process.env.GITHUB_TOKEN;
  return {
    name: 'github',
    status: hasApp || hasToken ? 'configured' : 'missing_auth',
    details: hasApp ? 'GitHub App auth configured' : hasToken ? 'GITHUB_TOKEN configured' : 'no GitHub credentials configured',
  };
}
