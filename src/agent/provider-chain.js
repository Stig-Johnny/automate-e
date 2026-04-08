import { resolveAgentProvider } from './provider-mode.js';

export function buildProviderChain(character) {
  const primary = resolveAgentProvider(character);
  const configuredFallbacks = normalizeProviderList(character.llm?.fallbackProviders || []);
  return dedupeProviders([primary, ...configuredFallbacks]);
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

function normalizeProviderList(value) {
  return Array.isArray(value)
    ? value.filter(v => typeof v === 'string' && v.trim())
    : [];
}

function dedupeProviders(providers) {
  const seen = new Set();
  const result = [];

  for (const provider of providers) {
    if (seen.has(provider)) continue;
    seen.add(provider);
    result.push(provider);
  }

  return result;
}
