import { createAnthropicSdkAgent } from './agent/providers/anthropic-sdk.js';
import { createClaudeCliAgent } from './agent/providers/claude-cli.js';
import { createCodexCliAgent } from './agent/providers/codex-cli.js';
import { buildProviderChain, resolveCharacterForProvider } from './agent/provider-chain.js';
import { toAgentProviderError } from './agent/provider-error.js';

export function createAgent(character, memory, mcpClients) {
  const providerChain = buildProviderChain(character);
  const providers = providerChain.map(provider => ({
    provider,
    agent: createProviderAgent(resolveCharacterForProvider(character, provider), memory, mcpClients),
  }));

  return {
    async process(message, context, dashboard, onProgress) {
      const failures = [];

      for (let index = 0; index < providers.length; index++) {
        const entry = providers[index];
        const isLast = index === providers.length - 1;

        try {
          if (index > 0) {
            const fallbackNotice = `Primary LLM unavailable. Retrying with ${entry.provider}...`;
            console.warn(`[Automate-E] ${fallbackNotice}`);
            if (dashboard) dashboard.addLog('warn', fallbackNotice);
            if (onProgress) await onProgress(fallbackNotice);
          }

          return await entry.agent.process(message, context, dashboard, onProgress);
        } catch (error) {
          const providerError = toAgentProviderError(entry.provider, error);
          failures.push(providerError);

          const fallbackAllowed = providerError.fallbackEligible !== false;
          const failureNotice = buildProviderFailureNotice(entry.provider, providerError, fallbackAllowed, isLast);
          console.error(`[Automate-E] ${failureNotice}`);
          if (dashboard) dashboard.addLog('error', failureNotice);
          if (onProgress) await onProgress(failureNotice);

          if (!fallbackAllowed || isLast) {
            const finalError = new Error(providerError.message);
            finalError.userMessage = providerError.userMessage
              || buildFallbackFailureMessage(failures);
            throw finalError;
          }
        }
      }

      throw new Error('No LLM providers configured.');
    },
  };
}

function createProviderAgent(character, memory, mcpClients) {
  switch (character.llm.provider) {
    case 'codex-cli':
      return createCodexCliAgent(character, memory, mcpClients);
    case 'claude-cli':
      return createClaudeCliAgent(character, memory, mcpClients);
    case 'anthropic':
    default:
      return createAnthropicSdkAgent(character, memory, mcpClients);
  }
}

function buildFallbackFailureMessage(failures) {
  if (failures.length === 1) {
    return failures[0].userMessage || 'Sorry, something went wrong. Please try again.';
  }

  const providers = failures.map(f => f.provider).join(', ');
  return `All configured LLM providers failed (${providers}). Please try again.`;
}

function buildProviderFailureNotice(provider, providerError, fallbackAllowed, isLast) {
  const detail = providerError.userMessage || providerError.message;
  const nextStep = (!fallbackAllowed || isLast)
    ? 'No fallback providers remain.'
    : 'Trying the next configured provider.';

  return `Provider ${provider} failed: ${detail} ${nextStep}`.trim();
}
