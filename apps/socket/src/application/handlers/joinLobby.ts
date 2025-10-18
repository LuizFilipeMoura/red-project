import { EVENTS, LOBBY_CAPACITY, schemas } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../errors.js';
import type { EventHandler, HandlerContext } from '../types.js';
import { verifyPassword } from '../../security.js';
import { initializeMatchState, type PlayerState } from '../../state.js';

const schema = schemas[EVENTS.JOIN];

type JoinLobbyInput = z.infer<typeof schema>;

export const handleJoinLobby: EventHandler<JoinLobbyInput> = async (context, input) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  await lobby.mutex.runExclusive(async () => {
    if (lobby.players.some((player) => player.sid === context.sid)) {
      await context.joinLobbyRoom(lobby.meta.id);
      return;
    }

    if (lobby.players.length >= LOBBY_CAPACITY) {
      throw new ApplicationError('FULL', 'Lobby is full');
    }

    if (!verifyPassword(lobby.meta.passwordHash ?? null, input.password)) {
      throw new ApplicationError('PASSWORD', 'Invalid password');
    }

    const joinedAt = Date.now();
    const inserted = await context.db.player.create({
      data: {
        lobbyId: lobby.meta.id,
        sid: context.sid,
        joinedAt: new Date(joinedAt),
        isReady: false,
      },
      select: { id: true },
    });

    const playerState: PlayerState = {
      lobbyId: lobby.meta.id,
      sid: context.sid,
      joinedAt,
      isReady: false,
      id: inserted?.id ?? undefined,
    };

    lobby.players.push(playerState);
    await context.joinLobbyRoom(lobby.meta.id);

    if (lobby.players.length === LOBBY_CAPACITY) {
      const first = lobby.players[Math.floor(Math.random() * lobby.players.length)];
      const second = lobby.players.find((player) => player.sid !== first.sid);
      if (second) {
        lobby.currentPlayerSid = first.sid;
        lobby.turnNumber = 1;
        lobby.meta.status = 'started';
        lobby.match = initializeMatchState(lobby, [first.sid, second.sid]);
        await context.db.lobby.update({
          where: { id: lobby.meta.id },
          data: { status: lobby.meta.status },
        });
      }
    }

    await context.broadcastState(lobby);
  });
};

const postProcessJoinLobby = async (context: HandlerContext, input: JoinLobbyInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) return;

  setTimeout(async () => {
    context.logger.info({ lobbyId: input.lobbyId }, 'Delayed state sync after 100ms');
    await context.broadcastState(lobby);
  }, 100);

  setTimeout(async () => {
    context.logger.info({ lobbyId: input.lobbyId }, 'Delayed state sync after 1000ms');
    await context.broadcastState(lobby);
  }, 1000);
};

export const joinLobbyDefinition = {
  event: EVENTS.JOIN,
  schema,
  useRateLimit: true,
  handler: handleJoinLobby,
  postProcess: postProcessJoinLobby,
} as const;
