import { createAnthropicSdkAgent } from './agent/providers/anthropic-sdk.js';
import { createClaudeCliAgent } from './agent/providers/claude-cli.js';
import { createCodexCliAgent } from './agent/providers/codex-cli.js';
import { createOpenAiApiAgent } from './agent/providers/openai-api.js';
import { buildProviderChain, resolveCharacterForProvider } from './agent/provider-chain.js';
import { getActiveProvider } from './agent/provider-state.js';
import { toAgentProviderError } from './agent/provider-error.js';

export function createAgent(character, memory, mcpClients) {
  const configuredProviders = buildProviderChain(character);
  const providers = new Map(configuredProviders.map(provider => ([
    provider,
    createProviderAgent(resolveCharacterForProvider(character, provider), memory, mcpClients),
  ])));

  return {
    async process(message, context, dashboard, onProgress) {
      const provider = getActiveProvider(character);
      const agent = providers.get(provider);
      if (!agent) {
        throw new Error(`Configured provider '${provider}' is not available.`);
      }

      if (onProgress) {
        await onProgress(`Using provider ${provider}.`);
      }

      try {
        return await agent.process(message, context, dashboard, onProgress);
      } catch (error) {
        const providerError = toAgentProviderError(provider, error);
        const failureNotice = `Provider ${provider} failed: ${providerError.userMessage || providerError.message}`;
        console.error(`[Automate-E] ${failureNotice}`);
        if (dashboard) dashboard.addLog('error', failureNotice);
        if (onProgress) {
          await onProgress(failureNotice);
        }

        const finalError = new Error(providerError.message);
        finalError.userMessage = providerError.userMessage || 'The selected provider failed. Switch provider and retry.';
        throw finalError;
      }
    },
  };
}

function createProviderAgent(character, memory, mcpClients) {
  switch (character.llm.provider) {
    case 'codex-cli':
      return createCodexCliAgent(character, memory, mcpClients);
    case 'claude-cli':
      return createClaudeCliAgent(character, memory, mcpClients);
    case 'openai-api':
      return createOpenAiApiAgent(character, memory, mcpClients);
    case 'anthropic':
    default:
      return createAnthropicSdkAgent(character, memory, mcpClients);
  }
}
