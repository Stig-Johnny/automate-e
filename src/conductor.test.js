/**
 * Unit tests for conductor.js — run with: node src/conductor.test.js
 *
 * Uses Node's built-in test runner (node:test, available since Node 18).
 * No network calls — fetch is replaced with a mock.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// --- Fetch mock ---
let fetchCalls = [];
let fetchShouldReject = false;

global.fetch = async (url, opts) => {
  fetchCalls.push({ url, body: JSON.parse(opts?.body || '{}') });
  if (fetchShouldReject) throw new Error('Network error');
  return { ok: true, status: 200 };
};

// Helper: reload conductor module with fresh env
async function loadConductor(env = {}) {
  // Save + patch env
  const saved = {};
  const keys = ['CONDUCTOR_BASE_URL', 'AGENT_ID', 'CONDUCTOR_REPO', 'CONDUCTOR_ISSUE_NUMBER'];
  for (const k of keys) {
    saved[k] = process.env[k];
    if (env[k] !== undefined) process.env[k] = env[k];
    else delete process.env[k];
  }

  // Dynamic import with cache-busting via query string trick isn't possible in ESM.
  // Instead we test via the exported function directly, relying on env vars being
  // read at call time (not at module load time) — which is how conductor.js is written.
  const { reportTokenUsage } = await import('./conductor.js');

  return { reportTokenUsage, restore: () => {
    for (const k of keys) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }};
}

describe('reportTokenUsage', () => {
  beforeEach(() => {
    fetchCalls = [];
    fetchShouldReject = false;
    delete process.env.CONDUCTOR_BASE_URL;
    delete process.env.AGENT_ID;
    delete process.env.CONDUCTOR_REPO;
    delete process.env.CONDUCTOR_ISSUE_NUMBER;
  });

  afterEach(() => {
    delete process.env.CONDUCTOR_BASE_URL;
    delete process.env.AGENT_ID;
    delete process.env.CONDUCTOR_REPO;
    delete process.env.CONDUCTOR_ISSUE_NUMBER;
  });

  test('no-op when CONDUCTOR_BASE_URL is not set', async () => {
    process.env.AGENT_ID = 'dev-e-1';
    const { reportTokenUsage } = await import('./conductor.js');

    reportTokenUsage({ model: 'claude-haiku-4-5-20251001', inputTokens: 100, outputTokens: 50, costUsd: 0.0001 });

    // Allow microtasks to settle
    await new Promise(r => setTimeout(r, 10));
    assert.equal(fetchCalls.length, 0);
  });

  test('no-op when AGENT_ID is not set', async () => {
    process.env.CONDUCTOR_BASE_URL = 'http://conductor:8080';
    const { reportTokenUsage } = await import('./conductor.js');

    reportTokenUsage({ model: 'claude-haiku-4-5-20251001', inputTokens: 100, outputTokens: 50, costUsd: 0.0001 });

    await new Promise(r => setTimeout(r, 10));
    assert.equal(fetchCalls.length, 0);
  });

  test('posts TOKEN_USAGE event when both env vars are set', async () => {
    process.env.CONDUCTOR_BASE_URL = 'http://conductor:8080';
    process.env.AGENT_ID = 'dev-e-1';
    const { reportTokenUsage } = await import('./conductor.js');

    reportTokenUsage({
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1200,
      outputTokens: 340,
      costUsd: 0.00042,
    });

    await new Promise(r => setTimeout(r, 10));
    assert.equal(fetchCalls.length, 1);

    const call = fetchCalls[0];
    assert.equal(call.url, 'http://conductor:8080/api/events');
    assert.equal(call.body.type, 'TOKEN_USAGE');
    assert.equal(call.body.agentId, 'dev-e-1');
    assert.equal(call.body.model, 'claude-haiku-4-5-20251001');
    assert.equal(call.body.inputTokens, 1200);
    assert.equal(call.body.outputTokens, 340);
    assert.equal(call.body.costUsd, 0.00042);
  });

  test('uses CONDUCTOR_REPO and CONDUCTOR_ISSUE_NUMBER from env', async () => {
    process.env.CONDUCTOR_BASE_URL = 'http://conductor:8080';
    process.env.AGENT_ID = 'dev-e-1';
    process.env.CONDUCTOR_REPO = 'Stig-Johnny/automate-e';
    process.env.CONDUCTOR_ISSUE_NUMBER = '74';
    const { reportTokenUsage } = await import('./conductor.js');

    reportTokenUsage({ model: 'claude-haiku-4-5-20251001', inputTokens: 100, outputTokens: 50, costUsd: 0.0001 });

    await new Promise(r => setTimeout(r, 10));
    const body = fetchCalls[0].body;
    assert.equal(body.repo, 'Stig-Johnny/automate-e');
    assert.equal(body.issueNumber, 74);
  });

  test('caller-supplied repo/issueNumber override env vars', async () => {
    process.env.CONDUCTOR_BASE_URL = 'http://conductor:8080';
    process.env.AGENT_ID = 'dev-e-1';
    process.env.CONDUCTOR_REPO = 'Stig-Johnny/other-repo';
    process.env.CONDUCTOR_ISSUE_NUMBER = '99';
    const { reportTokenUsage } = await import('./conductor.js');

    reportTokenUsage({
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 100, outputTokens: 50, costUsd: 0.0001,
      repo: 'Stig-Johnny/automate-e',
      issueNumber: 74,
    });

    await new Promise(r => setTimeout(r, 10));
    const body = fetchCalls[0].body;
    assert.equal(body.repo, 'Stig-Johnny/automate-e');
    assert.equal(body.issueNumber, 74);
  });

  test('network failure does not throw — fails silently', async () => {
    process.env.CONDUCTOR_BASE_URL = 'http://conductor:8080';
    process.env.AGENT_ID = 'dev-e-1';
    fetchShouldReject = true;
    const { reportTokenUsage } = await import('./conductor.js');

    // Must not throw
    assert.doesNotThrow(() => {
      reportTokenUsage({ model: 'claude-haiku-4-5-20251001', inputTokens: 100, outputTokens: 50, costUsd: 0.0001 });
    });

    await new Promise(r => setTimeout(r, 20));
    // fetch was called but rejected — no crash
    assert.equal(fetchCalls.length, 1);
  });

  test('defaults issueNumber to 0 when env not set', async () => {
    process.env.CONDUCTOR_BASE_URL = 'http://conductor:8080';
    process.env.AGENT_ID = 'dev-e-1';
    const { reportTokenUsage } = await import('./conductor.js');

    reportTokenUsage({ model: 'claude-haiku-4-5-20251001', inputTokens: 100, outputTokens: 50, costUsd: 0.0001 });

    await new Promise(r => setTimeout(r, 10));
    assert.equal(fetchCalls[0].body.issueNumber, 0);
    assert.equal(fetchCalls[0].body.repo, '');
  });
});
