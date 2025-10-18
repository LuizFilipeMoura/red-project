import { EVENTS, schemas } from '@repo/shared';
import type { z } from 'zod';
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
    await context.db.player.deleteMany({
      where: {
        lobbyId: lobby.meta.id,
        sid: context.sid,
      },
    });

    await context.leaveLobbyRoom(lobby.meta.id);

    if (lobby.players.length === 0) {
      context.clearLobbyTimeout(lobby.meta.id);
      lobby.currentPlayerSid = null;
      lobby.deadlineAt = null;
    }

    lobby.meta.status = 'waiting';
    await context.db.lobby.update({
      where: { id: lobby.meta.id },
      data: { status: lobby.meta.status },
    });

    if (lobby.currentPlayerSid === context.sid) {
      lobby.currentPlayerSid = lobby.players[0]?.sid ?? null;
      if (lobby.currentPlayerSid) {
        context.scheduleTurnTimeout(lobby);
      }
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
