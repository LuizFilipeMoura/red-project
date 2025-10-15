import { sql } from 'drizzle-orm';
import {
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const lobbies = sqliteTable('lobbies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
  passwordHash: text('password_hash'),
  capacity: integer('capacity').notNull(),
  ownerSid: text('owner_sid'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s','now') * 1000)`),
  status: text('status').notNull().default('waiting'),
});

export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lobbyId: text('lobby_id')
    .notNull()
    .references(() => lobbies.id, { onDelete: 'cascade' }),
  sid: text('sid').notNull(),
  joinedAt: integer('joined_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s','now') * 1000)`),
  isReady: integer('is_ready', { mode: 'boolean' }).notNull().default(false),
});

export const turns = sqliteTable('turns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lobbyId: text('lobby_id')
    .notNull()
    .references(() => lobbies.id, { onDelete: 'cascade' }),
  stateJson: text('state_json').notNull(),
  currentPlayerSid: text('current_player_sid'),
  turnNumber: integer('turn_number').notNull().default(0),
  deadlineAt: integer('deadline_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s','now') * 1000)`),
});
