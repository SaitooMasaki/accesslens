import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ローカル開発: DATABASE_SSL=false。本番(Supabase/Railway等)は省略でOK
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool unexpected error');
});

export async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    logger.info('Database schema applied');
  } finally {
    client.release();
  }
}
