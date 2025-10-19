-- CreateTable
CREATE TABLE "lobbies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "password_hash" TEXT,
    "capacity" INTEGER NOT NULL,
    "owner_sid" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'waiting'
);

-- CreateTable
CREATE TABLE "players" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lobby_id" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_ready" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "players_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "current_player_sid" TEXT NOT NULL,
    "turn_number" INTEGER NOT NULL,
    "state_json" TEXT NOT NULL,
    "decks_json" TEXT NOT NULL DEFAULT '{}',
    "cards_json" TEXT NOT NULL DEFAULT '{}',
    "talents_json" TEXT NOT NULL DEFAULT '{}',
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "matches_id_fkey" FOREIGN KEY ("id") REFERENCES "lobbies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "match_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "owner_sid" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "can_move_at_turn" INTEGER NOT NULL,
    "hp" INTEGER NOT NULL DEFAULT 1,
    "hp_max" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "units_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "actions_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "match_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "actions_log_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_lobby_status_created" ON "lobbies"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_player_per_lobby" ON "players"("lobby_id", "sid");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_unit_cell" ON "units"("match_id", "x", "y");
