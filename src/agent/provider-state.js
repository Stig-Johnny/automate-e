import fs from 'node:fs';
import path from 'node:path';
import { buildProviderChain } from './provider-chain.js';

const DEFAULT_PROVIDER_STATE_FILE = 'automate-e-active-provider';

export function getConfiguredProviders(character) {
  return buildProviderChain(character);
}

export function getProviderStateFilePath() {
  const stateRoot = process.env.CODEX_HOME
    || process.env.AUTOMATE_E_STATE_DIR
    || process.env.HOME
    || process.cwd();
  return path.join(stateRoot, DEFAULT_PROVIDER_STATE_FILE);
}

export function getActiveProvider(character) {
  const configuredProviders = getConfiguredProviders(character);
  const persisted = readPersistedProvider();
  return configuredProviders.includes(persisted)
    ? persisted
    : configuredProviders[0];
}

export function setActiveProvider(character, provider) {
  const normalizedProvider = normalizeProviderSelection(character, provider);
  const configuredProviders = getConfiguredProviders(character);
  if (!configuredProviders.includes(normalizedProvider)) {
    throw new Error(`Unknown provider '${provider}'. Configured providers: ${configuredProviders.join(', ')}`);
  }

  writePersistedProvider(normalizedProvider);
  return normalizedProvider;
}

export function describeProviderState(character) {
  const configuredProviders = getConfiguredProviders(character);
  const activeProvider = getActiveProvider(character);
  return `Active provider: ${activeProvider}. Configured providers: ${configuredProviders.join(', ')}.`;
}

function readPersistedProvider() {
  try {
    return fs.readFileSync(getProviderStateFilePath(), 'utf8').trim();
  } catch {
    return '';
  }
}

function writePersistedProvider(provider) {
  fs.mkdirSync(path.dirname(getProviderStateFilePath()), { recursive: true });
  fs.writeFileSync(getProviderStateFilePath(), `${provider}\n`);
}

function normalizeProviderSelection(character, provider) {
  const rawProvider = String(provider || '').trim();
  if (!rawProvider) return rawProvider;

  const configuredProviders = getConfiguredProviders(character);
  if (configuredProviders.includes(rawProvider)) {
    return rawProvider;
  }

  const normalized = rawProvider.toLowerCase();
  const aliases = [
    [['codex', 'codex-cli', 'chatgpt'], 'codex-cli'],
    [['claude', 'claude-cli', 'claude-code', 'claude code'], 'claude-cli'],
    [['openai', 'openai-api', 'openai api'], 'openai-api'],
    [['anthropic', 'anthropic-api', 'anthropic api'], 'anthropic'],
    [['baseline'], 'baseline'],
  ];

  for (const [names, target] of aliases) {
    if (names.includes(normalized) && configuredProviders.includes(target)) {
      return target;
    }
  }

  return rawProvider;
}
