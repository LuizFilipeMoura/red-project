import 'dotenv/config';

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? 'dev-secret',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
};
