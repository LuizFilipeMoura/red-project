import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = fileURLToPath(new URL('.', import.meta.url));

export const getDatabase = (databaseUrl = process.env.DATABASE_URL ?? 'sqlite.db') => {
  const db = new Database(databaseUrl);
  return drizzle(db);
};

export const runMigrations = async () => {
  const db = new Database(process.env.DATABASE_URL ?? 'sqlite.db');
  const client = drizzle(db);
  await migrate(client, { migrationsFolder: join(dirname, 'migrations') });
  return client;
};

export * from './schema.js';
