CREATE TABLE IF NOT EXISTS "lobbies" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "is_private" integer DEFAULT 0 NOT NULL,
  "password_hash" text,
  "capacity" integer NOT NULL,
  "owner_sid" text,
  "created_at" integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
  "status" text DEFAULT 'waiting' NOT NULL
);

CREATE TABLE IF NOT EXISTS "players" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "lobby_id" text NOT NULL,
  "sid" text NOT NULL,
  "joined_at" integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
  "is_ready" integer DEFAULT 0 NOT NULL,
  FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS "turns" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "lobby_id" text NOT NULL,
  "state_json" text NOT NULL,
  "current_player_sid" text,
  "turn_number" integer DEFAULT 0 NOT NULL,
  "deadline_at" integer,
  "created_at" integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
  FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE cascade
);
