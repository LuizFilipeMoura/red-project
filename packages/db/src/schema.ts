import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const lobbies = sqliteTable('lobbies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
  passwordHash: text('password_hash'),
  capacity: integer('capacity').notNull(),
  ownerSid: text('owner_sid'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  status: text('status').notNull().default('waiting'),
});

export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lobbyId: text('lobby_id').notNull().references(() => lobbies.id, { onDelete: 'cascade' }),
  sid: text('sid').notNull(),
  joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull(),
  isReady: integer('is_ready', { mode: 'boolean' }).notNull().default(false),
});

export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(),
  currentPlayerSid: text('current_player_sid').notNull(),
  turnNumber: integer('turn_number').notNull(),
  stateJson: text('state_json').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const units = sqliteTable('units', {
  id: text('id').primaryKey(),
  matchId: text('match_id')
    .notNull()
    .references(() => matches.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  ownerSid: text('owner_sid').notNull(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  canMoveAtTurn: integer('can_move_at_turn').notNull(),
});

export const actionsLog = sqliteTable('actions_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  payloadJson: text('payload_json').notNull(),
  ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
});
