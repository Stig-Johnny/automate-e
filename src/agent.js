import { createAnthropicSdkAgent } from './agent/providers/anthropic-sdk.js';
import { createClaudeCliAgent } from './agent/providers/claude-cli.js';
import { createCodexCliAgent } from './agent/providers/codex-cli.js';
import { resolveAgentProvider } from './agent/provider-mode.js';

export function createAgent(character, memory, mcpClients) {
  switch (resolveAgentProvider(character)) {
    case 'codex-cli':
      return createCodexCliAgent(character, memory, mcpClients);
    case 'claude-cli':
      return createClaudeCliAgent(character, memory, mcpClients);
    case 'anthropic':
    default:
      return createAnthropicSdkAgent(character, memory, mcpClients);
  }
}
