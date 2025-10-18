import { EVENTS, LOBBY_CAPACITY, makeMsg, paginationSchema } from '@repo/shared';
import type { z } from 'zod';
import type { EventHandler } from '../../types.js';
import { toLobby } from '../../../state.js';

const schema = paginationSchema;

type ListLobbiesInput = z.infer<typeof schema>;

export const handleListLobbies: EventHandler<ListLobbiesInput> = async (context, input) => {
  const lobbiesArray = Array.from(context.store.values())
    .filter((lobby) => !lobby.meta.isPrivate)
    .filter((lobby) => lobby.players.length < LOBBY_CAPACITY)
    .sort((a, b) => a.meta.createdAt - b.meta.createdAt);

  const total = lobbiesArray.length;
  const start = (input.page - 1) * input.pageSize;
  const end = start + input.pageSize;
  context.socket.emit(
    EVENTS.LIST,
    makeMsg(EVENTS.LIST, {
      items: lobbiesArray.slice(start, end).map((lobby) => toLobby(lobby)),
      page: input.page,
      total,
    }),
  );
};

export const listLobbiesDefinition = {
  event: EVENTS.LIST,
  schema,
  useRateLimit: true,
  handler: handleListLobbies,
} as const;
