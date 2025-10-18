CREATE TABLE IF NOT EXISTS "lobbies" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "is_private" integer DEFAULT 0 NOT NULL,
  "password_hash" text,
  "capacity" integer NOT NULL,
  "owner_sid" text,
  "created_at" integer NOT NULL,
  "status" text DEFAULT 'waiting' NOT NULL
);

CREATE TABLE IF NOT EXISTS "players" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "lobby_id" text NOT NULL,
  "sid" text NOT NULL,
  "joined_at" integer NOT NULL,
  "is_ready" integer DEFAULT 0 NOT NULL,
  FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "matches" (
  "id" text PRIMARY KEY NOT NULL,
  "current_player_sid" text NOT NULL,
  "turn_number" integer NOT NULL,
  "state_json" text NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "units" (
  "id" text PRIMARY KEY NOT NULL,
  "match_id" text NOT NULL,
  "type" text NOT NULL,
  "owner_sid" text NOT NULL,
  "x" integer NOT NULL,
  "y" integer NOT NULL,
  "can_move_at_turn" integer NOT NULL,
  FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "actions_log" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "match_id" text NOT NULL,
  "type" text NOT NULL,
  "payload_json" text NOT NULL,
  "ts" integer NOT NULL,
  FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "players_lobby_id_index" ON "players" ("lobby_id");
CREATE INDEX IF NOT EXISTS "units_match_id_index" ON "units" ("match_id");
CREATE INDEX IF NOT EXISTS "actions_log_match_id_index" ON "actions_log" ("match_id");
