import { resolveAgentProvider } from './provider-mode.js';

/**
 * Returns all configured providers. The first is the default (from character.llm.provider).
 * Additional providers come from character.llm.providers keys.
 * Only ONE runs at a time — controlled by provider-state.js.
 */
export function buildProviderChain(character) {
  const primary = resolveAgentProvider(character);
  const additional = Object.keys(character.llm?.providers || {}).filter(p => p !== primary);
  return [primary, ...additional];
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
