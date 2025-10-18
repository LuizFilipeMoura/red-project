import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import * as schema from './schema.js';

const globalForClients = globalThis as unknown as {
  sqlite?: Database;
  prisma?: PrismaClient;
};

const createConnection = () => new Database(env.DATABASE_FILE);

const sqlite = globalForClients.sqlite ?? createConnection();

if (process.env.NODE_ENV !== 'production') {
  globalForClients.sqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });

export const prisma = globalForClients.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForClients.prisma = prisma;
}

export * from './schema.js';
export * from '@prisma/client';
