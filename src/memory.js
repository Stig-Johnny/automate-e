import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facts (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, fact)
);

CREATE TABLE IF NOT EXISTS patterns (
  id SERIAL PRIMARY KEY,
  merchant TEXT NOT NULL UNIQUE,
  account_code TEXT NOT NULL,
  vat_rate INTEGER NOT NULL,
  confidence REAL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_thread ON conversations(thread_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id);
-- idx_patterns_merchant not needed: UNIQUE constraint on merchant already creates an index
`;

export async function createMemory() {
  const connectionString = process.env.DATABASE_URL;

  // If no database configured, use in-memory fallback
  if (!connectionString) {
    console.warn('[Book-E] No DATABASE_URL — using in-memory storage (data lost on restart)');
    return createInMemoryStore();
  }

  let pool;
  try {
    pool = new pg.Pool({ connectionString });
    await pool.query(SCHEMA);
    console.log('[Book-E] Postgres memory initialized');
  } catch (error) {
    console.warn('[Book-E] Postgres connection failed, falling back to in-memory:', error.message);
    return createInMemoryStore();
  }

  return {
    async getConversation(threadId, limit = 20) {
      const result = await pool.query(
        'SELECT role, content FROM conversations WHERE thread_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
        [threadId, limit]
      );
      return result.rows.reverse();
    },

    async saveMessage(threadId, role, content, userId = null) {
      await pool.query(
        'INSERT INTO conversations (thread_id, role, content, user_id) VALUES ($1, $2, $3, $4)',
        [threadId, role, content, userId]
      );
    },

    async getFacts(userId) {
      const result = await pool.query(
        'SELECT fact FROM facts WHERE user_id = $1 ORDER BY confidence DESC',
        [userId]
      );
      return result.rows.map(r => r.fact);
    },

    async saveFact(userId, fact, confidence = 1.0) {
      await pool.query(
        `INSERT INTO facts (user_id, fact, confidence) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, fact) DO UPDATE SET confidence = $3`,
        [userId, fact, confidence]
      );
    },

    async getPattern(merchant) {
      const result = await pool.query(
        'SELECT account_code, vat_rate FROM patterns WHERE merchant = $1',
        [merchant]
      );
      return result.rows[0] || null;
    },

    async savePattern(merchant, accountCode, vatRate) {
      await pool.query(
        `INSERT INTO patterns (merchant, account_code, vat_rate) VALUES ($1, $2, $3)
         ON CONFLICT (merchant) DO UPDATE SET account_code = $2, vat_rate = $3, updated_at = NOW()`,
        [merchant, accountCode, vatRate]
      );
    },

    async close() {
      await pool.end();
    },
  };
}

function createInMemoryStore() {
  const conversations = new Map();
  const facts = new Map();
  const patterns = new Map();

  return {
    async getConversation(threadId, limit = 20) {
      const msgs = conversations.get(threadId) || [];
      return msgs.slice(-limit);
    },
    async saveMessage(threadId, role, content, userId = null) {
      if (!conversations.has(threadId)) conversations.set(threadId, []);
      conversations.get(threadId).push({ role, content });
    },
    async getFacts(userId) {
      return facts.get(userId) || [];
    },
    async saveFact(userId, fact) {
      if (!facts.has(userId)) facts.set(userId, []);
      const userFacts = facts.get(userId);
      if (!userFacts.includes(fact)) userFacts.push(fact);
    },
    async getPattern(merchant) {
      return patterns.get(merchant) || null;
    },
    async savePattern(merchant, accountCode, vatRate) {
      patterns.set(merchant, { account_code: accountCode, vat_rate: vatRate });
    },
    async close() {},
  };
}
