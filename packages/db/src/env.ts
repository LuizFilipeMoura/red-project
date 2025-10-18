const DEFAULT_DB = process.env.NODE_ENV === 'test' ? ':memory:' : 'sqlite.db';

export const env = {
  DATABASE_FILE: process.env.DATABASE_FILE ?? DEFAULT_DB,
};
