/**
 * Worker process — consumes messages from Redis stream, runs Claude agent loop,
 * publishes replies back to Redis for the gateway to deliver.
 *
 * Multiple replicas can run in parallel (consumer group ensures each message
 * is processed by exactly one worker).
 *
 * Requires: REDIS_URL, ANTHROPIC_API_KEY, CHARACTER_FILE
 * Optional: DATABASE_URL (for Postgres memory)
 */
import Redis from 'ioredis';
import { loadCharacter } from './character.js';
import { createAgent } from './agent.js';
import { createMemory } from './memory.js';

const STREAM_MESSAGES = 'automate-e:messages';
const STREAM_REPLIES = 'automate-e:replies';
const MAX_STREAM_LEN = 10000;
const GROUP_NAME = 'workers';

const character = loadCharacter();
const memory = await createMemory();
const agent = createAgent(character, memory);

const dashboard = {
  addLog(level, message) {
    console.log(`[Worker] [${level}] ${message}`);
  },
  addToolCall(name, status, latencyMs) {
    console.log(`[Worker] Tool: ${name} ${status} (${latencyMs}ms)`);
  },
  updateSession() {},
};

// --- Redis ---
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('[Worker] REDIS_URL is required in worker mode');
  process.exit(1);
}

const redis = new Redis(redisUrl);
redis.on('error', (err) => console.error('[Worker] Redis error:', err.message));

const consumerId = `worker-${process.pid}-${Date.now()}`;

try {
  await redis.xgroup('CREATE', STREAM_MESSAGES, GROUP_NAME, '$', 'MKSTREAM');
  console.log(`[Worker] Created consumer group '${GROUP_NAME}'`);
} catch (err) {
  if (!err.message.includes('BUSYGROUP')) throw err;
}

console.log(`[Worker] Started (consumer: ${consumerId}), character: ${character.name}`);

// --- Graceful shutdown ---
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Worker] ${signal} received, finishing current work...`);
    // Let the current iteration finish, then exit
  });
}

// --- Main consume loop ---
while (!shuttingDown) {
  try {
    const results = await redis.xreadgroup(
      'GROUP', GROUP_NAME, consumerId,
      'COUNT', 1,
      'BLOCK', 5000,
      'STREAMS', STREAM_MESSAGES, '>',
    );

    if (!results) continue;

    for (const [, entries] of results) {
      for (const [id, fields] of entries) {
        try {
          const msg = JSON.parse(fields[1]);
          console.log(`[Worker] Processing message from ${msg.authorName} (thread: ${msg.threadId})`);

          const response = await agent.process(msg.messageContent, {
            userId: msg.authorId,
            userName: msg.authorName,
            channelId: msg.channelId,
            threadId: msg.threadId,
            attachments: msg.attachments || [],
          }, dashboard);

          const reply = {
            threadId: msg.threadId,
            content: response,
            isDM: msg.isDM,
          };

          await redis.xadd(STREAM_REPLIES, 'MAXLEN', '~', MAX_STREAM_LEN, '*',
            'payload', JSON.stringify(reply),
          );

          await redis.xack(STREAM_MESSAGES, GROUP_NAME, id);
          console.log(`[Worker] Replied to ${msg.threadId}`);
        } catch (err) {
          console.error('[Worker] Error processing message:', err.message);
          // Ack to prevent infinite retry — error is logged
          await redis.xack(STREAM_MESSAGES, GROUP_NAME, id);
        }
      }
    }
  } catch (err) {
    console.error('[Worker] Consumer loop error:', err.message);
    await new Promise(r => setTimeout(r, 1000));
  }
}

console.log('[Worker] Shutdown complete');
redis.disconnect();
process.exit(0);
