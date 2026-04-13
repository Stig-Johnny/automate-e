import { resolveAgentProvider } from './provider-mode.js';

export function buildProviderChain(character) {
  return [resolveAgentProvider(character)];
}

export function resolveCharacterForProvider(character, provider) {
  const providerOverrides = character.llm?.providers?.[provider] || {};
  return {
    ...character,
    llm: {
      ...character.llm,
      ...providerOverrides,
      provider,
    },
  };
}
