import 'dotenv/config';

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? 'dev-secret',
  DATABASE_URL: process.env.DATABASE_URL ?? 'sqlite.db',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
};
