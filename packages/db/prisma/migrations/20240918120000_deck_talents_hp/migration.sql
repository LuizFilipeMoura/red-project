-- CreateIndex
CREATE INDEX "idx_lobby_status_created" ON "lobbies"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_player_per_lobby" ON "players"("lobby_id", "sid");

-- AlterTable matches
ALTER TABLE "matches"
  ADD COLUMN "decks_json" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "cards_json" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "talents_json" TEXT NOT NULL DEFAULT '{}';

-- AlterTable units
ALTER TABLE "units"
  ADD COLUMN "hp" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "hp_max" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "uniq_unit_cell" ON "units"("match_id", "x", "y");
