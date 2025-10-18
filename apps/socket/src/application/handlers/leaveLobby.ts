import { and, eq } from 'drizzle-orm';
import { EVENTS, LOBBY_CAPACITY, schemas } from '@repo/shared';
import type { z } from 'zod';
import { players, lobbies as lobbiesTable, matches as matchesTable } from '@repo/db';
import type { EventHandler } from '../types.js';

const schema = schemas[EVENTS.LEAVE];

type LeaveLobbyInput = z.infer<typeof schema>;

export const handleLeaveLobby: EventHandler<LeaveLobbyInput> = async (context, input) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) return;

  await lobby.mutex.runExclusive(async () => {
    const index = lobby.players.findIndex((player) => player.sid === context.sid);
    if (index < 0) return;

    lobby.players.splice(index, 1);
    await context.db
      .delete(players)
      .where(and(eq(players.lobbyId, lobby.meta.id), eq(players.sid, context.sid)))
      .run();

    await context.leaveLobbyRoom(lobby.meta.id);

    if (lobby.players.length === 0) {
      context.clearLobbyTimeout(lobby.meta.id);
      lobby.currentPlayerSid = null;
      lobby.turnNumber = 0;
      lobby.deadlineAt = null;
      lobby.match = null;
      await context.db.delete(matchesTable).where(eq(matchesTable.id, lobby.meta.id)).run();
    } else if (lobby.players.length < LOBBY_CAPACITY) {
      lobby.match = null;
      lobby.currentPlayerSid = lobby.players[0]?.sid ?? null;
      lobby.turnNumber = lobby.currentPlayerSid ? 1 : 0;
    }

    lobby.meta.status = 'waiting';
    await context.db
      .update(lobbiesTable)
      .set({ status: lobby.meta.status })
      .where(eq(lobbiesTable.id, lobby.meta.id))
      .run();

    if (lobby.currentPlayerSid === context.sid) {
      lobby.currentPlayerSid = lobby.players[0]?.sid ?? null;
      lobby.turnNumber = lobby.currentPlayerSid ? 1 : 0;
    }

    await context.broadcastState(lobby);
  });
};

export const leaveLobbyDefinition = {
  event: EVENTS.LEAVE,
  schema,
  useRateLimit: true,
  handler: handleLeaveLobby,
} as const;
