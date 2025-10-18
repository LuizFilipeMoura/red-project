import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from './env.js';
import * as schema from './schema.js';

const globalForDb = globalThis as unknown as {
  sqlite: Database | undefined;
};

const createConnection = () => new Database(env.DATABASE_FILE);

const sqlite = globalForDb.sqlite ?? createConnection();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.sqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });

export * from './schema.js';
